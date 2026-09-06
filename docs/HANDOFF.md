<!-- 开新对话只需读这一份 + 它指向的文件。本文件不写后端契约、不写帧审批状态、不写死提交哈希。
     职责边界见 DECISIONS.md 第 6 节。最后更新 2026-09-04。 -->

# 交接索引 — AI 网文工作台（novel-generator）


**界面待清账在 `docs/UI-BACKLOG.md`**：新会话开工前先读它，做完一条就把整条删掉，
并把结论同步进 `docs/WORKSTREAM-PLAN.md` 的 §一 / §二 两张表。

## 工作方式（必须遵守）

- **主人新提的需求，当场写进 `docs/UI-BACKLOG.md`，再动手；一条都不留在对话里。**
      2026-09-05 主人原话：「你先把这几轮没弄的需求都给我记到 MD 文件里面去，
      **不要再在这里靠记忆了**，马上对话上下文又要满了」。对话必被截断，
      落不进文件的请求等于没提。每做完一条：勾掉 + 结论写 `WORKSTREAM-PLAN.md` + **单独提交**。
- 称呼主人，全程中文。
- 大块完整交付：做完整、验证通过再汇报，不要做一点说一点。
- 按 `docs/WORKSTREAM-PLAN.md` §三「接下来我做什么」的顺序推进，做完一条更新那两份表
  （§一 已经能用的 / §二 还差什么）。**进度只看这一份。**
- 及时 commit + push。git 需 `sandbox_permissions=require_escalated`（`.git` 只读挂载）；
  直连 push 必失败，走代理：`git -c http.proxy=http://127.0.0.1:7890 push origin main`
- **UI 铁律**：先在 Figma 画帧 → 截图给主人审批 → 批准后才写前端代码。主动发截图。
- 调 `use_figma` 前先读 `skill://figma/figma-use/SKILL.md`，skillNames 传 `resource:figma-use`。
  本项目 Figma 报错几乎都是脚本层（SCRIPT 桶），见 AGENTS.md 四桶与 DECISIONS 第 4 节 T-01～T-04。
- 遇到主人批评，先复述你理解的问题点再动手。
- **改任何界面之前先读 `docs/UI-DESIGN.md` §0.9 不可回退清单**，改完在
      `frontend/src/uiInvariants.test.ts` 里补/改一条断言，**同一提交**。主人 2026-09-05
      一次指出四处「你改回去了」，靠记忆保不住已定稿的东西，只有门禁能保住。
- **效果类改动必须真机截图、自己看过之后才说完成**。只看 diff 不算验证：本项目靠看渲染图
  抓到过「三条 CSS 被更高优先级选择器整组压掉」「JSX 文本节点里混进字面 dollar-brace」
  「设置页一行样式都没写」。取证通道见 AGENTS.md《前端取证通道》（本机无 Chrome，裸 Edge + CDP）。
- **写类工具（use_figma / 改文件 / git）第二次失败即停**，一条消息只发一个写调用。

- **CDP / 脚本里任何非 ASCII 内容，写入时禁用 `-Encoding ascii`**（2026-09-04 实测）。
  PowerShell 的 `Set-Content -Encoding ascii` 会把 `.mjs` 里的中文**静默变成 `?`**，于是
  `find(n => n.getAttribute("aria-label") === "展开调用记录")` 永远匹配不上，报出来的
  「控件不存在 / row not found / doors: []」**全是脚本 bug，不是产品缺陷**。本轮被它误导三次，
  白查两轮。**用 `-Encoding utf8`**；稳妥做法是先 `.map()` 把值读出来确认，再用中文字面量比较。

  机械闸门 `~/.codex/scripts/dispatch_gate.py` 已装（Pre+Post 双事件，台账在
  `%TEMP%\codex-dedupe-gate\dispatch.jsonl`），但 hook **只在会话启动时装载**：改过 hooks.json
  或尚未 trust 时，需主人重启会话并在 `/hooks` 里 trust，当前会话不会回头重读配置。
- 编码四原则：编码前思考 / 简洁优先 / 精准修改 / 目标驱动执行。

## 三条红线（违反即错，不解释）

1. **四层规划只有一条写入口**：`PUT /api/novels/{id}/files/{path}`。`/planning/*` 只读，写请求一律 410；
   新建章节与简报也走同一条文件层 `PUT`。禁止在任何地方开第二条写通路（DECISIONS D-01）。
   DB 仍是唯一真源，`chapters/NNNN/{draft.md,brief.md}` 是投影（D-02 / D-03）。
   **人物档案同理**（D-15）：`settings/characters/{id}.md` 走同一入口，`POST/PUT /characters`
   已 410；`portrait` 是 base64 资产、不进文档，走只写它自己的窄端点。
2. **不许把「测试全绿」说成「功能已实现」**。谈 Agent 能力前先 grep 取证，改完再拿真模型 / 真浏览器跑一遍。
   2026-09-04 S2 第 1 步落地（工具注册表 / 多步循环 / `web_search` / 步数与 token 上限），
   但**它仍然没有写文件的工具**：改规划只有「提案 → 主人点应用」这一条（缺口现状见 ARCHITECTURE §4）。
   本轮三个真缺陷全是**跑出来的、不是测出来的**：模型换工具方言导致控制块上屏、重复读文件烧光预算、
   改主键的提案卡片点了才 422。见 DECISIONS T-15 / T-16 / T-17。
3. **上下文注入只有一个构造器**，改注入内容只改对应 collector，不改调用方、不改提示词模板、
   不改前端（D-04 / D-06）。

## 环境

- 代码 `E:\novel-generator`；远端 `github.com/qi001007/ai_novel_generator`（main，最新见 `git log -1`）。
- LLM：OpenAI 兼容 `/chat/completions`。配置**存在数据库 `app_config` 表**，在 `/settings` 页面改；
  `backend/.env` 降为首次种子与未覆盖项的兜底（D-16）。密钥只写不读：接口只回 `****` + 尾 4 位，
  别把它当明文回填。.env 本身仍已 gitignore，勿写进代码或提交。
  任务类型四个：`draft` / `review` / `summary` / `chat`。当前 `NOVEL_LLM_CHAT_MODEL=MiniMax-M2.5`
  （推理模型，reasoning 计入 `token_output`，是真实账单口径 → T-10）。
- `.scratch/` 存本机过程产物（日志、截图、启动脚本），**不在 git 里**，别在文档中引用它当证据。
- **两个服务用可见终端跑**：`.scratch\run-backend.cmd`（8000，带 NOVEL_CONTEXT_DEBUG=1）与
  `.scratch\run-frontend.cmd`（5173）。它们会随会话中断被回收——主人报「白屏 / 空数据 /
  你根本没改」时，**先确认服务在不在跑**，再怀疑代码。改过后端若接口 404 或 500，先重启并跑
  `alembic upgrade head`（`--reload` 只热重载代码，不跑迁移）。
- **重启服务前先看端口上有几个监听**（本会话踩过）：`netstat -ano | Select-String ':8000\s'`。
  直接再 `Start-Process` 一次会得到**两个进程同时听 8000**，新连接被派到那个已卡死的旧进程上，
  表现是「health 20 秒不答」——看着像代码坏了，其实是双绑定。判据：`Get-NetTCPConnection` 查不到
  或 `curl` 拿不到 HTTP 码时，先数监听数，再谈重启。

## 验证命令（改动后必须全绿）

```powershell
cd E:\novel-generator\backend;  .venv\Scripts\python.exe -m pytest -q    # 期望 208 passed
cd E:\novel-generator\frontend; npm run test -- --run                      # 期望 198 passed / 21 files
cd E:\novel-generator\frontend; npx tsc -b --force --pretty false           # 必须 clean（--force，别信增量）
cd E:\novel-generator\frontend; npm run build                              # 期望干净
cd E:\novel-generator\.scratch; node hit-area-audit.mjs                     # 期望 0 small / 0 clipped / 0 unreachable

# 界面不可回退闸门（改界面必须同批改这里的断言，见 UI-DESIGN §0.9）
#   frontend/src/uiInvariants.test.ts —— 现 38 块（数它：git show HEAD:frontend/src/uiInvariants.test.ts | 数 it(" 的行）
```

要看注入上下文清单：后端起时带 `$env:NOVEL_CONTEXT_DEBUG = '1'`，跑在**可见终端**里
（主人明确要过：别把方便留给自己、让他去翻日志文件）。

S1 隔离冒烟：`cd E:\novel-generator\backend; .venv\Scripts\python.exe scripts\writing_ring_smoke.py`；
默认模板草稿，加 `--live` 才会真实调用模型。

**文档自己也要清账**（主人两次明确要求：「删一些，给后端纪要留空间」）。2026-09-06 这一轮：
`UI-BACKLOG` 31.3KB → 5.9KB、`UI-DESIGN` 48.3KB → 35.4KB、
`WORKSTREAM-PLAN` 34.6KB → 7.6KB（第二十三批：整份改成说人话的进度表，S/U 编号与
《四、历史》流水表删除，结论改由提交信息与 DECISIONS 承载）。
判断标准只有一条——**本文件是开新对话要读的最小信息，任何「正文」都不该在这里**。
删掉的都是已被别处接管的过程记录，未结项一条没丢；每轮删了什么记在
`git log --oneline -- docs/`；要看某一份的旧版，
`git show <提交>:docs/<文件>`。

## 读哪份文件

| 你要干什么 | 读哪里 |
|---|---|
| 知道系统实际长什么样、还缺什么 | `docs/ARCHITECTURE.md` |
| 知道某设计为什么这么定 / 哪个旧口径已废 | `docs/DECISIONS.md`（按 D-xx / X-xx / R-xx / T-xx 编号） |
| 改需求、加功能 | `docs/PRD.md` → 同步 `docs/REQUIREMENTS.md` |
| 改界面 | `docs/UI-DESIGN.md`（§0 令牌、§0.7-§0.9 纪律与不可回退清单、§1-§7 页面规格） |
| 界面还有什么没做 | `docs/UI-BACKLOG.md`（只记未完成，勾完即删） |
| **看进度、还差什么、下一步** | `docs/WORKSTREAM-PLAN.md`（**只看这一份**，已改成说人话，不再用 S/U 编号组织） |
| 工具报错怎么定责 | `AGENTS.md` 四桶（NAME / ARGS / SCRIPT / QUOTA） |

## 当前主干进度

一句话：**主链能跑（规划 → 注入 → 生成 → 校验 → 审稿 → 落库），界面已冻结，
接下来按 `WORKSTREAM-PLAN.md` §三 的顺序接后端**。以前这段是手抄的摘要，
抄一次就旧一次，现在只留这一句 + 指向。

```text
S0 上下文可观测   代码就绪，欠一次「/generate 全链真调 API 跑给主人看」（要点头，会烧 token）
S3 写通路收口     已落地并按 D-15 延伸到设定库；只剩「删掉退役后无效的导入/助手」一条
S1 最小写作环     隔离脚本 + 统一预算裁剪已落地
S2 agentic 内核   已在真模型上跑通 读 → 提案 → 人点应用 → 生正文；S4 未开始
S4 合流           未开始（对话式管理接写作环、Ctrl+K）
UI                主人 2026-09-06 判定可以冻结：「目前这个前端我算是比较满意了，可以开始接后端了」
                  未结四条见 UI-BACKLOG，其中伏笔墙／地图接线被他明确排到最后
```

待主人拍板的存量事项：`DECISIONS.md` §5.3 的 **Q-07**（反馈记录要不要进文件层并 410 `/feedback`）、
**Q-08**（`required_facts` 字面子串匹配把改写判成缺失）、**Q-09**（人物「删除」调的
`DELETE /characters/{id}` 从未存在，必然 405）。三条与「删除作品」同属**删除语义**，一起定。
D-15、D-16 已批准。

## 三条给接手的人（都是跑出来、不是测出来的）

- **别目测，去量**。缩略栏「粘手」量出来是画与拖两套数；书架「影子糊在书上」量出来是 15px
  模糊向上够进书体 24.8px；「图标没居中」量出来是 −2.5px。目测永远给不出这些数。
- **假控件比没控件更糟**。能点但什么都不做的按钮，一律改成 `disabled` + 写明原因
  （树右键、生图任务行、删除作品都是这个口径）。宁可承认没做，不许让它看起来像做完了。
- **测试全绿 ≠ 功能实现**。`uiInvariants` 与 vitest 都不解析样式表：菜单第一项被刷成
  实心主色条、字也是主色（看不见），只有真机截图看得出来（T-19）。
