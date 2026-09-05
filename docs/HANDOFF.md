<!-- 开新对话只需读这一份 + 它指向的文件。本文件不写后端契约、不写帧审批状态、不写死提交哈希。
     职责边界见 DECISIONS.md 第 6 节。最后更新 2026-09-04。 -->

# 交接索引 — AI 网文工作台（novel-generator）


**界面待清账在 `docs/UI-BACKLOG.md`**：新会话开工前先读它，做完一条勾一条，并把结论同步一行到 `WORKSTREAM-PLAN.md`。

## 工作方式（必须遵守）

- **主人新提的需求，当场写进 `docs/UI-BACKLOG.md`，再动手；一条都不留在对话里。**
      2026-09-05 主人原话：「你先把这几轮没弄的需求都给我记到 MD 文件里面去，
      **不要再在这里靠记忆了**，马上对话上下文又要满了」。对话必被截断，
      落不进文件的请求等于没提。每做完一条：勾掉 + 结论写 `WORKSTREAM-PLAN.md` + **单独提交**。
- 称呼主人，全程中文。
- 大块完整交付：做完整、验证通过再汇报，不要做一点说一点。
- 按 `docs/WORKSTREAM-PLAN.md` 的 S 系列主干顺序推进，每完成一项打勾。
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
cd E:\novel-generator\backend;  .venv\Scripts\python.exe -m pytest -q    # 期望 180 passed
cd E:\novel-generator\frontend; npm run test -- --run                      # 期望 125 passed / 18 files
cd E:\novel-generator\frontend; npx tsc -b --force --pretty false           # 必须 clean（--force，别信增量）
cd E:\novel-generator\frontend; npm run build                              # 期望干净
cd E:\novel-generator\.scratch; node hit-area-audit.mjs                     # 期望 0 small / 0 clipped / 0 unreachable

# 界面不可回退闸门（改界面必须同批改这里的断言，见 UI-DESIGN §0.9）
#   frontend/src/uiInvariants.test.ts —— 现 20 块
```

要看注入上下文清单：后端起时带 `$env:NOVEL_CONTEXT_DEBUG = '1'`，跑在**可见终端**里
（主人明确要过：别把方便留给自己、让他去翻日志文件）。

S1 隔离冒烟：`cd E:\novel-generator\backend; .venv\Scripts\python.exe scripts\writing_ring_smoke.py`；
默认模板草稿，加 `--live` 才会真实调用模型。

**2026-09-05 文档清账（主人：「删除一些落后的、之前写的推进计划，保证文档简洁」）**：
`WORKSTREAM-PLAN.md` 从 886 行 / 88KB 压到 229 行 / 17KB——它自己第一节就写着「只记进度与勾选，
已完成一律进 DECISIONS」，却靠批注流水涨到那个体积，而涨到那个体积没让任何一条决定更清楚。
所有**未结**条目逐条搬走、一条没丢（含第六轮那条「调用记录面板按内容给高」，它差点被流水埋掉）。
`UI-BACKLOG.md` 按「勾完即删该条」清掉第十五批 13 条已完成项。

**界面批注的唯一合法流程已写进 `AGENTS.md`《UI 批注处理闭环》（2026-09-05 主人要求固化）**：
当场写进 `UI-BACKLOG` 带判据 → 按严重度一条一条做 → 真机截图自己看过 → 同一提交改
`uiInvariants` 断言 → 文档四件套 → 每条单独 commit+push → **做完的从 UI-BACKLOG 删掉** →
整批做完交主人审核。顺手发现的别的缺陷只登记不顺手改。

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
S2 agentic 内核   第 1 步已落地并**在真模型上跑通读→提案→应用→生正文**；S4 接写作环未开始
UI  支线          帧 26 已清账（C 区长字段 + A 区设定库树 + ④在文件中新建）；三册中伏笔/世界观已进文件层，反馈册待 Q-07
S4 合流           未开始
UI  支线          批准的设计帧仍有未清账项，逐条见 WORKSTREAM-PLAN 的 U 系列
```

待主人拍板的存量事项：`DECISIONS.md` §5.3 的 **Q-07**（反馈记录要不要进文件层并 410 `/feedback`）、
**Q-08**（`required_facts` 字面子串匹配把改写判成缺失）、**Q-09**（人物「删除」调的
`DELETE /characters/{id}` 从未存在，必然 405）。三条与「删除作品」同属**删除语义**，一起定。
D-15、D-16 已批准。

**给下一个接手的人**：主人 2026-09-04 的原话是「一开始让你改前端 bug、实现批准的 Figma 稿，
你忘了，我看你根本就没改」。教训两条——① **批准的设计稿没落地就是没做完**，不能用「帧出了」
或「测试全绿」顶替；② 别躲进 Figma 建帧、后端收口这类自留地，先清主人点名的界面。

**2026-09-04 前端清账轮（主人：「后端先存档，现在先改前端」）**：主人第四轮 16 条浏览器批注里
可修的全部修完，逐条真机量过（该轮明细已折叠进 WORKSTREAM-PLAN《四、历史》一行，过程原文用
`git show <提交>:docs/WORKSTREAM-PLAN.md` 追溯）。三条值得接手的人记住：

- **能量的都别目测**。缩略栏「粘手」量出来是画与拖两套数 + `scrollTop/scrollHeight` 未归一；
  书架「影子粘在书上」量出来是 15px 模糊向上够进书体 24.8px；标签页「比例不对」量出来是
  `min-width:132px` 把关闭按钮推到离右边界 48.8px。目测永远看不出这些数字。
- **假控件比没控件更糟**。回形针能选 10 个文件、渲染出 chip，而 `streamChat` 只发
  `content/mode/chapter_id/model`——选了就是扔了。已改 `disabled` + 说明，与仓内另外 5 处
  「暂未开放」同一口径。**宁可显式承认没做，不许让它看起来像做完了。**
- **廉价感有一半是可测的**：逐元素算合成背景做对比度审计，浅色主题 13 处不过 AA，其中十处
  共用一个 `--text-2`（4.31，只差 0.19）。改一个 token 修十处。另：五处中文标到 10px，
  那是拉丁终端的字号。**剩两处是品牌色决策，已交主人，不在 bug 修复里擅自动主色。**

本轮**没做**的，以及为什么：批注 15 的「重命名 / 删除」需要后端删除语义（全仓除 `chat.py`
无任何 delete 路由），与 Q-07 / Q-09 是同一条决策，不在前端臆造第二条写通路；批注 9 / 10 / 12 / 14
是界面新增，按 UI 铁律要先出帧再落码。
