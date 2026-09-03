# 架构现状（ARCHITECTURE）

本文件只记**系统实际长什么样**与**推进主干**。为什么这样定见 `DECISIONS.md`（下文以 D-xx／X-xx 引用编号）。
最后更新：2026-09-03。所有数字均为本机实测，不是转述。

## 0. 一句话形状

单机自用 Web 应用。前端一个 React 工作台；后端一个 FastAPI + SQLite；两块「AI」彼此分离：
**写文侧**（按注入上下文生成正文）与**对话侧**（讨论剧情、查资料、管规划）。
全产品的业务核心是写文侧**注入什么上下文**，不是模型本身。

## 1. 真源与写通路

现状（B 路，D-01 已收口）：一条入口，四层规划的任何修改都走它。

```text
人改文档 ─┐
AI 提案 ─┼─► PUT /api/novels/{id}/files/{path} ─► Markdown 解析 ─► DB 列
新建章节 ─┘   （键锁 / actor 白名单 / base_revision 409）
```

```text
人改文档 ─┐
AI 提案 ─┼─► PUT /api/novels/{id}/files/{path} ─► Markdown 解析 ─► DB 列
新建章节 ─┘   （键锁 / actor 白名单 / base_revision 409）
```

已退役：

```text
/planning/* POST / PUT ─► HTTP 410（只读 GET 保留）
```

- **DB 是唯一真源**（D-02）。`app/models.py` 里四层规划全是结构化列，库里不存文档文本；
  文件内容由 `services/documents.py` 每次现渲染、解析回列。换文件格式属纯投影层改动（零迁移、零 alembic）。
- 文件层统一携带键锁（D-10）、`actor=ai` 白名单、`base_revision` 乐观并发（409）与
  `stabilize_proposal`。新建章节首写 `chapters/NNNN/brief.md` 时同事务创建 `ChapterBrief + Chapter`。

### 路径现状（D-03）

```text
blueprint.md            A 全书蓝图
toc.md                  B 目录
arcs.md                 C 剧情弧
chapters/0042/brief.md  D 单章简报
chapters/0042/draft.md  正文投影     ← 旧编辑器与终审编辑均写这条路径
```

兼容：`resolve_path` 同时认新旧两种写法，**读旧写新**，不迁数据、不断链。

## 2. 上下文链路（产品核心，D-04 / D-05 / D-06）

```text
                collect_items(session, novel_id)        ← 唯一资料池
                        │
        ┌───────────────┴────────────────┐
  build_chat_context()          build_writing_context()
  排序＝问题相关度                  排序＝写作四档
  给对话 Agent                    给正文生成
        └───────────────┬────────────────┘
                  WritingContext ─► manifest_json() ─► generation_run.input_summary
                       │             └─► NOVEL_CONTEXT_DEBUG=1 时 print 到终端
                  render_context() → 提示词
```

写作四档（预算不足自低档起裁）：

1. **必注入**：作品信息与文风约束、A 蓝图、D 本章简报
2. **连续性**：当前弧、上一章结尾、出场人物当前状态、**所有未回收伏笔**
3. **邻域**：B 目录 N±3、近 5 章摘要、被点名设定
4. **填充**：其余按相关度

不变量（有测试钉住）：预算再紧也不得裁掉未回收伏笔与出场人物状态。

空内容**不算注入**：必注入档若字段为空，出现在未注入区并写明「本章实际缺少该资料」（T-14）。

一份真实清单（2026-09-02 只读跑真库 novel 1 第 43 章，944/12000 字）：

```text
 1-6.  [必注入] blueprint          A 全书蓝图 · 主线/主题/核心冲突/约束/终局
 7.    [必注入] brief       142 字  D 简报 · 第 43 章
 8.    [必注入] arc          67 字  C 剧情弧 · 碑与人（42-48）
 9.    [必注入] character     35 字  人物 · 沈曜
 10.   [连续性] chapter     123 字  上一章结尾 · 第 42 章
 11-14.[邻域]   brief/toc/setting   第 42、43 章相邻简报与目录、星渊碑设定
 15.   [填充]   character     14 字  人物 · 沈云
 --.   [填充]   chapter     123 字  未注入：正文 · 第 42 章（与已注入的上一章结尾重复）
```

清单里看不到伏笔档不等于机制漏了：novel 1 没有伏笔行，伏笔尚无写入端点（见 §4 缺口 4）。


## 3. 模块完成度（不粉饰）

| 模块 | 行数 | 实际能力 | 完成度 |
|---|---|---|---|
| `services/llm.py` | 211 | OpenAI 兼容客户端，流式带 usage，任务类型 draft/review/summary/chat 四个，未配置时明确降级 | 可用 |
| `services/context.py` | 953 | 唯一采集池 + 两种排序 + 清单双通道 + @引用解析 + 去重 | **核心已成形** |
| `services/documents.py` + `markdown_doc.py` | 538 + 291 | MD 投影读写、键锁、AI 白名单、乐观并发、提案稳定化、按章路径与原子建章 | 可用 |
| `services/chat.py` | 353 | 多轮（`HISTORY_WINDOW=8`）、落库、SSE 五事件、@引用、token 记账、提案抽取 | **只是外壳，见 §4 缺口 1** |
| `services/{chapters,reviews,draft,planning,prompts}.py` | 约 550 | 机械校验、七维自检、章摘要、流水线编排 | 可用 |
| `app/models.py` | 303 | 15 张表：novel / blueprint / toc / arc / brief / chapter / setting / character / appearance / foreshadow / summary / feedback / generation_run / review / chat_message | 可用 |
| 前端 | 约 5.6k | 书架 / 工作台三栏 / 双根树 / MD 文件编辑器（CodeMirror 6）/ 对话坞 / 提案卡 / 人物卡库 | 设计已定，UI 迭代未完 |

实测门禁：后端 **107 passed**，前端 **52 passed / 13 files**，`npm run build` 干净。
**测试通过只代表已有代码自洽，不代表主人要的功能已实现**——两者在本文件里分开写（§3 与 §4）。

## 4. 缺口清单（明确没有什么，而不是「差不多」）

| # | 缺什么 | 证据 | 归属 |
|---|---|---|---|
| 1 | **Agent 没有 agentic 内核**：无工具调用、无联网搜索、无自主多步循环 | `tool_call` / `function_call` / `web_search` 在整个 backend **零命中**；一次请求＝一次 LLM 调用＝一路文本回来即结束 | S2 |
| 2 | `/search` 斜杠命令不存在（曾被文档列为 v1 需求） | 实际只有 `/generate /review /check /summary /save /plan /feedback`（`ChatPane.tsx:76`） | S2 |
| 3 | 双栏对照生成 + 逐段合并、选区 Diff 修改 | WORKSTREAM C4 全节未勾；Figma 帧 05 已批但代码未做（T-12） | S1 之后 |
| 4 | 伏笔没有写入端点 | 注入清单里伏笔档为空，novel 1 无 `foreshadow` 行 | P2 |
| 5 | 绘画 / AI 生图是**纯前端假数据** | `artwork` / `painting` 在后端零命中；`PaintingDetailPanel.tsx` 无后端来源 | P3 |
| 6 | **删除作品功能整体缺失**（不是只缺端点） | 前端 `BookshelfPage`／`workbench` 里 `删除`／`del(` 零命中，`api.ts` 的 `del` 无人调用；后端 `routers/novels.py` 只 GET/POST/PUT；而 PRD §2 与 UI-DESIGN §1 都要它 | S3 之后（DECISIONS 5.2） |
| 7 | 磁盘导出镜像未做 | D-02 列 P2 且只单向导出 | P2 |

## 5. 推进主干（S 系列）

不是三个互相隔离的最小项目最后拼接——那三块共享 `novel / chapter / brief / setting / character`，
各自建一份数据层，合并那天要重新发明一遍 DB 模型，且没有测试能保护那次合并。
**是一条数据主干，三次能力叠加。代码一行不删。每步先写测试再实现。**

```text
S0 上下文可观测
   代码已就绪（c385f5b / b397081）。缺的只是把它摆到台面上跑一次给人看。
   验收：NOVEL_CONTEXT_DEBUG 打开后生成一章，终端打印清单，主人能指出哪项多余、哪项缺失。

S1 最小写作环
   空临时库 → 文件层写 A/B/C/D → 一次注入 → 出正文。
   对话与写作预算统一交给 `apply_context_budget()`；只有排序规则不同。
   验收：一个只读脚本跑通全链，中途打印清单，可与 §2 那份 novel 1 清单逐项对比。

S3 写通路收口 + 路径迁移（一次做完）
   A 路写端点退役（D-01）＋ 路径改 chapters/NNNN/{brief,draft}.md（D-03）。
   ★ 排在 S2 之前：Agent 的管理规划命令必须绑在唯一入口上，
     否则是把双真源问题自动化放大，而不是解决它。
   验收：全仓只剩一条写四层规划的路径；`/planning/*` 只剩 GET；新旧路径往返测试通过；
         后端测试数不降（≥101），前端 51 全绿，build 干净。

S2 agentic 内核
   工具注册表 + 多步循环 + 联网搜索 + 本系统内部命令（含按规范管规划）。
   复用：`prepare_turn()` 已是「取历史 + 选上下文 + 组 messages」，正是循环每圈的输入侧。
   约束：Agent 写规划只能走 S3 收口后的那一条通路，且 actor=ai（受 D-10 白名单限制）。
   验收：给一句自然语言「把 45-48 章收进第二个弧并补钩子」，它自己拆成 读 → 提案 → 人点应用，
         全程不产生第二条写通路。

S4 合流
   对话式管理接上写作环；Ctrl+K 命令面板；编辑器高级能力（帧 05 双栏 / 选区 Diff）。
```

当前进度：**S0 代码就绪待演示 → S3 写通路、正文投影与帧 21/22 前端已落地 →
S1 隔离写作环已跑通 → S2 未开始 → S4 未开始**。逐项勾选在 `WORKSTREAM-PLAN.md`。

## 6. 验证命令

```powershell
# 后端（必须用 .venv 里的 python，不是系统 python）
cd E:\novel-generator\backend; .venv\Scripts\python.exe -m pytest -q         # 期望 107 passed

# 带注入清单起后端（可见终端；控制台需 UTF-8 防中文乱码）
cd E:\novel-generator\backend
$env:NOVEL_CONTEXT_DEBUG = '1'
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# S1 最小写作环（隔离临时库；默认模板草稿，不耗 token）
cd E:\novel-generator\backend
.venv\Scripts\python.exe scripts\writing_ring_smoke.py

# 前端
cd E:\novel-generator\frontend; npm run test -- --run                        # 期望 52 passed
cd E:\novel-generator\frontend; npm run build
```

开发时 `:5173` 由 Vite 把 `/api` 代理到 `:8000`。`backend/.env` 自动加载，密钥不入库；
`GET /api/llm/status` 只返回供应商 / 地址 / 模型配置状态，不返回密钥。
