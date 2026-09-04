<!-- 开新对话只需读这一份 + 它指向的文件。本文件不写后端契约、不写帧审批状态、不写死提交哈希。
     职责边界见 DECISIONS.md 第 6 节。最后更新 2026-09-04。 -->

# 交接索引 — AI 网文工作台（novel-generator）

## 工作方式（必须遵守）

- 称呼主人，全程中文。
- 大块完整交付：做完整、验证通过再汇报，不要做一点说一点。
- 按 `docs/WORKSTREAM-PLAN.md` 的 S 系列主干顺序推进，每完成一项打勾。
- 及时 commit + push。git 需 `sandbox_permissions=require_escalated`（`.git` 只读挂载）；
  直连 push 必失败，走代理：`git -c http.proxy=http://127.0.0.1:7890 push origin main`
- **UI 铁律**：先在 Figma 画帧 → 截图给主人审批 → 批准后才写前端代码。主动发截图。
- 调 `use_figma` 前先读 `skill://figma/figma-use/SKILL.md`，skillNames 传 `resource:figma-use`。
  本项目 Figma 报错几乎都是脚本层（SCRIPT 桶），见 AGENTS.md 四桶与 DECISIONS 第 4 节 T-01～T-04。
- 遇到主人批评，先复述你理解的问题点再动手。
- **效果类改动必须真机截图、自己看过之后才说完成**。只看 diff 不算验证：本项目靠看渲染图
  抓到过「三条 CSS 被更高优先级选择器整组压掉」「JSX 文本节点里混进字面 dollar-brace」
  「设置页一行样式都没写」。取证通道见 AGENTS.md《前端取证通道》（本机无 Chrome，裸 Edge + CDP）。
- **写类工具（use_figma / 改文件 / git）第二次失败即停**，一条消息只发一个写调用。
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
2. **不许把「测试全绿」说成「功能已实现」**。对话 Agent 目前只有外壳，工具调用 / 联网搜索 /
   多步循环 = 0（ARCHITECTURE §4 缺口 1）。
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

## 验证命令（改动后必须全绿）

```powershell
cd E:\novel-generator\backend;  .venv\Scripts\python.exe -m pytest -q    # 期望 131 passed
cd E:\novel-generator\frontend; npm run test -- --run                      # 期望 64 passed / 15 files
cd E:\novel-generator\frontend; npm run build                              # 期望干净
```

要看注入上下文清单：后端起时带 `$env:NOVEL_CONTEXT_DEBUG = '1'`，跑在**可见终端**里
（主人明确要过：别把方便留给自己、让他去翻日志文件）。

S1 隔离冒烟：`cd E:\novel-generator\backend; .venv\Scripts\python.exe scripts\writing_ring_smoke.py`；
默认模板草稿，加 `--live` 才会真实调用模型。

## 读哪份文件

| 你要干什么 | 读哪里 |
|---|---|
| 知道系统实际长什么样、还缺什么 | `docs/ARCHITECTURE.md` |
| 知道某设计为什么这么定 / 哪个旧口径已废 | `docs/DECISIONS.md`（按 D-xx / X-xx / R-xx / T-xx 编号） |
| 改需求、加功能 | `docs/PRD.md` → 同步 `docs/REQUIREMENTS.md` |
| 改界面 | `docs/UI-DESIGN.md`（当前权威版本见其首行） |
| 看进度与待办勾选 | `docs/WORKSTREAM-PLAN.md` |
| 工具报错怎么定责 | `AGENTS.md` 四桶（NAME / ARGS / SCRIPT / QUOTA） |

## 当前主干进度（细节与验收在 WORKSTREAM-PLAN）

```text
S0 上下文可观测   代码已就绪，待跑给主人看一次
S3 写通路收口     已落地，并按 D-15 延伸到设定库
S1 最小写作环     隔离脚本与统一预算裁剪已落地
S2 agentic 内核   **下一步**；工具调用 / 联网搜索 / 多步循环仍为 0
S4 合流           未开始
UI  支线          批准的设计帧仍有未清账项，逐条见 WORKSTREAM-PLAN 的 U 系列
```

待主人拍板的存量事项：`DECISIONS.md` 第 5 节没有未决 Q 编号；D-15、D-16 已批准。

**给下一个接手的人**：主人 2026-09-04 的原话是「一开始让你改前端 bug、实现批准的 Figma 稿，
你忘了，我看你根本就没改」。教训两条——① **批准的设计稿没落地就是没做完**，不能用「帧出了」
或「测试全绿」顶替；② 别躲进 Figma 建帧、后端收口这类自留地，先清主人点名的界面。
