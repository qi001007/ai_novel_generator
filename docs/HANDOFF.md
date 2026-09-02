<!-- 本文件取代手动粘贴的开新对话提示词。开新对话时让模型读 docs/HANDOFF.md 即可。
     最后更新 2026-09-02，同步自会话 01a05fb7 的首条提示词。 -->

# 项目：AI 网文工作台（novel-generator）

## 身份与工作方式（必须遵守）

- 称呼我"主人"，全程中文回复。

- 大块完整交付：每个任务做完整、验证通过再汇报，不要做一点说一点。

- 严格按 docs/WORKSTREAM-PLAN.md 顺序推进，每完成一项打勾。

- 及时 commit + push。git 命令必须用 sandbox_permissions=require_escalated（.git 只读挂载）。

 直连 push 必失败，走代理：git -c http.proxy=http://127.0.0.1:7890 push origin main

- UI 铁律：先在 Figma 画帧 → 截图给我审批 → 批准后才写前端代码。主动发截图。

- 调 Figma use_figma 前必须先读 skill://figma/figma-use/SKILL.md，skillNames 传 "resource:figma-use"。

- 遇到我批评，先复述你理解的问题点再动手。

- 编码四原则：编码前思考 / 简洁优先 / 精准修改 / 目标驱动执行。

## 环境

- 代码 E:\novel-generator；远端 github.com/qi001007/ai_novel_generator（main）

- 最新提交见 `git log -1`（本文件不写死哈希，避免再次过期）

- 后端 cd backend; .venv\Scripts\python.exe -m pytest → 99/99 绿

- 前端 cd frontend; npm run test -- --run → 51/51；npm run build 干净

- 设计规范唯一依据 docs/UI-DESIGN.md v3；分工文档 docs/WORKSTREAM-PLAN.md

- 主题：石墨灰 + 朱砂 #C2492F/#E06A4E，深浅双主题，圆角 10/8/6，lucide 图标，正文思源宋体 17px/1.9

- LLM：BaseURL [https://api.scnet.cn/api/llm/v1（OpenAI](https://api.scnet.cn/api/llm/v1（OpenAI) 兼容），密钥在 backend/.env（已 gitignore，

 不要写进代码或提交）。NOVEL_LLM_CHAT_MODEL=MiniMax-M2.5（用最便宜档）。流式可用，

 支持 stream_options.include_usage。

- 后端 dev server 在跑：[http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health) → 200

## 【已证实】Figma MCP 可用，不要再声称不可用

- whoami = qi007 / pro team；use_figma 能真实写画板，get_design_context / download_assets 能读回。

- 上一任模型说"use_figma 只由远程 server 提供、本会话 tools 为空"，那是错的，已推翻。
- 该错判的来源：把 Figma 官方排障文档的条件句当成了现场事实 + 把 github/mineru 真掉线误推广到 Figma。
  判别流程见下一节，正文规则在 AGENTS.md。

- 文件 [https://www.figma.com/design/HTdQ7kTwpsbpAJvBdpMvXP/Novel-Generator-Workspace-v2](https://www.figma.com/design/HTdQ7kTwpsbpAJvBdpMvXP/Novel-Generator-Workspace-v2)

 fileKey HTdQ7kTwpsbpAJvBdpMvXP，唯一 page "Screens"(0:1)，16+3 个顶层帧，

 网格 3 列 x=0/1640/3280，行 y=0/1100/2200/3300/4400，帧 1440x900。

## 【规则】Figma / MCP 故障分流（正文见 AGENTS.md，勿在此重复）

- ⚠️ 报错含 `no such property`（如 `node.getRangeExtent: no such property … on TEXT node`）＝ **Figma 在
  执行你的脚本**，是脚本调了不存在的方法，与工具面无关：改脚本，禁止原样重试。详见 AGENTS.md 第 1 条。
- `unsupported call: <name>` ＝ 仅指 harness 原文这句；此时改用表内真实全名，仍失败就停下报告，不许循环重试。
- 报错里带 `at <anonymous> (PLUGIN_N_SOURCE:…)` 和 `Figma Debug UUID` ＝ **工具在正常执行**，
  是你的脚本违规，按下面《Figma 操作纪律》改脚本，不许再推广成"工具面在掉"。
- **写类工具（use_figma / apply_patch / 写文件）失败时禁止盲目重试**：harness 会重放同消息内的
  tool_use，重试即重复改动画布。要重发必须先 findOne 删旧保证幂等。
- `tool call limit on the … plan` ＝ Figma 服务端额度，与工具面无关。
- 探活只用 `mcp__figma__whoami`（约 300ms、payload 最小、额度豁免）。
  **禁止**用 `list_mcp_resources` 当活体探针：它读启动期缓存的 schema，工具全不可用时照样返回全量。
- 从 `read_mcp_resource` 读来的官方排障文档只能当"待验证假设"。官方原句
  「The `use_figma` or `generate_figma_design` tool isn't available」的条件前半句是
  "同时配置了 desktop server `127.0.0.1:3845` 遮蔽远程 server"——本机 3845 无监听、配置无此项，条件不成立。
- 2026-09-02 二次取证：`use_figma` 结构化派发 **316 次＝259 成功 / 57 服务端真报错 / 0 次派发失败**；
  被判 `tools unavailable` 的只有 mineru(21)、github(18)、codex_apps(1)，**figma 从未上榜**。

## Figma 操作纪律（本轮实测踩坑，务必遵守）

- ⚠️ 本 harness 会把我一条消息里的多个 tool_use 重放/并发执行。**每条消息只发一个 use_figma 写调用**，

 否则同一帧的 auto-layout 会被跑两遍（本会话 thumb.resize 因此从 104→229→338→447 失控）。

- 所有写脚本必须幂等：先 findOne(n=>n.name===X) 删旧再建。

- 新建 auto-layout frame 默认 100x100 且两轴 FIXED；必须显式设 primaryAxisSizingMode /

 counterAxisSizingMode = 'AUTO'，否则出现"按钮高 100、条高 100"这种坑。

- 覆盖式元素（minimap thumb、代码区装饰）用 layoutPositioning='ABSOLUTE'，否则会顶开后续兄弟。

- 图标用 figma.createNodeFromSvg(lucide 的 svg 字符串) 生成，比手画矩形可靠。

- 颜色 0-1；fills/strokes 只读数组要整体赋值；layoutSizing 先 append 再设；resize() 在设 sizing 之前。

- 字体真实 style 名：Inter 是 "Semi Bold"（带空格）；JetBrains Mono 没有 SemiBold；

 Noto Sans SC 没有 SemiBold（有 Regular/Medium/Bold/Black/DemiLight/Light/Thin）。

 文件里没有 CJK 等宽字体，代码块里的中文必须 setRangeFontName 换成 Noto Sans SC。

- get_screenshot 不要传 maxDimension（schema 报错）。下载导出图：

 node -e "fetch(...).then(r=>r.arrayBuffer()).then(a=>require('fs').writeFileSync(p,Buffer.from(a)))"

 配 sandbox_permissions=require_escalated + $env:HTTPS_PROXY="http://127.0.0.1:7890"（沙箱内直连 figma 会超时）。

- 可视化目录 C:/Users/Administrator/.codex/visualizations/2026/09/02/01a05f76-8750-7741-bb13-0c6a7f88da65

 （已有 f17-a.png / f18-a.png / f19-a.png 三帧最终导出图）

- apply_patch 在本环境偶发 `failed to parse function arguments`：那是**参数层**类型退化，不是工具不存在。
  重试即可；仍失败改写用 PowerShell here-string 或临时 Python 脚本走 backend venv。

- Playwright 未安装；页面截图用 headless Edge：

 & 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu

 --no-first-run --hide-scrollbars --window-size=1540,1272 --virtual-time-budget=10000 --screenshot=<abs.png> <url>

## Figma 帧状态

现存 13 帧：05框选双栏(35:26) 08人物(59:80) 09反馈时间线(59:165) 10世界观地图(59:265)

11伏笔墙(59:312) 12书架v3(85:2) 13封面弹层(85:45) 14对话坞三态(107:4) 15模型菜单(110:79)

16绘画详情(117:38) 17文件编辑器A蓝图(155:252) 18AI提案diff(286:2) 19B→D跳转(286:162)

已删 6 帧：01/03/04（早期稿）、06(53:26)/07(59:26)（集成表单页，被帧 17 取代）、

02工作台(21:26)（迁移前稿，留档 figma-archive/frame-02-workbench.png）。

注意：06/07 当年声称的 PNG 留档实际不存在，只有 02 这次是真落盘核验过的。

**待我审批 3 帧（第 6 行 y=4400）**：

- 17 文件编辑器 · A 蓝图 = 155:252 —— VSCode 式横向标签 + 行号 + 键锁竖条 + 当前行 + caret

 \+ minimap（thumb 覆盖式）+ 状态栏；侧栏已补 D 层入口 单章简报/briefs/ + 0042.yaml + 0043.yaml；

 正文是真实 blueprint.yaml 渲染（20 行，五个键名朱砂加粗）

- 18 AI 提案 diff · 应用前 = 286:2 —— 对话里提案卡（红删/绿增 + "键名与主键锁定 · AI 只改值" +

 在编辑器中打开/丢弃/应用），编辑器第 18 行琥珀"← 提案待应用"带，保存置灰、dirty 点隐藏，

 状态栏"1 处提案待应用 · 尚未写入服务器"

- 19 B→D 跳转定位 = 286:162 —— 侧栏选中 0043.yaml，标签激活 briefs/0043.yaml，file-bar 下朱砂

 来源条"↩ 来自 toc.yaml · 第 43 章 · plot_function …… 返回来源"，正文是真实 D 简报 YAML（11 行，

 chapter/arc 带锁），当前行停在 goal: 并标"← 目录跳转落点"

- YAML 文案不是手编的，是调 backend/app/services/documents.py 的 dump_document 真跑出来的，

 与后端真实文件一致。

## 开场动作

- ⚠️ 先读 `AGENTS.md`《Figma / MCP 故障分流》第 0-3 条。本项目的 Figma 报错几乎都是
  **脚本层**（`no such property` 那一类），不是工具面消失；**写类工具失败时禁止重试**，
  重发必须先 findOne 删旧保证幂等。判定「工具不存在」只认 harness 原文 `unsupported call:`。
- 另有一项待核查未结：重复写是否把帧 17/18/19 的位移算了两遍，见
  `docs/WORKSTREAM-PLAN.md` 末节《待核查》。先跑核查再动画板。

1. git status + git log -3 看清状态；读 docs/WORKSTREAM-PLAN.md 的 C4d/C5 段。

2. 先问我："帧 17/18/19 批不批？"——我没批准之前**不要写任何前端代码**。

3. 我上一批浏览器批注还没处理，其中拖拽边界/人物贴照片/对话坞过高/minimap 风格，

  在提交 e2f36fa 里已经被上一任**未经批准**动过代码了。先问我那几处要不要回滚、

  等三帧批完再统一重做。

## 待我拍板（三件，问过没答）

1. B 层 plot_function/notes 与 D 层 goal/events 语义重叠 → 跳转落点按字段映射

  （plot_function→goal、notes→events），还是把 B 收敛成纯索引（只留 chapter+title），描述全放 D。

2. 编辑器组件：CodeMirror 6（轻、Vite 友好）还是 Monaco（更 VSCode、要配 worker）。

3. 确认 D 层在左树里就是文件节点（briefs/0042.yaml），不是"第 N 章简报"表单节点。

## 后端契约（已提交，Figma 文案的事实来源）

提交链 ada1a88(C5 chat agent) → e2f36fa(C5a) → a8ca64f(document layer) → e512b6e(docs) → a197501(docs 更正)

- services/documents.py + routers/documents.py：把四层规划投影成虚拟 YAML 文件（DB 仍是真源）

 blueprint.yaml A：main_line/ending/core_conflicts/themes/constraints

 toc.yaml B：chapter/title/plot_function/notes

 arcs.yaml C：arc/title/start_chapter/end_chapter/objective/conflict/resolution/status

 briefs/00NN.yaml D：chapter/arc/goal/events/pov/characters/conflict/hook/required_facts/status

 多行散文用 |-，短标量列表内联，allow_unicode，width=10000 不自动折行

- 锁：任何写者改键名/加键/删键 = 422；chapter 必须等于文件名章号；actor=ai 再限制到白名单字段

 （A 全 5；B title/plot_function/notes；C title/objective/conflict/resolution/status；D 除 chapter+arc 外全部），

 AI 永不能增删行

- GET /api/novels/{id}/files；GET|PUT /api/novels/{id}/files/{path}；读返回 revision=sha1(render)[:12]，

 写可带 base_revision → 409

- AI→文件通道：回复含 \`\`\`yaml @path 块 → SSE proposal 事件 {path,text,valid,error}，只有人点"应用"才写入

- 真库小说 id=1《九霄观星录》：42 章 126 字、1 设定、1 人物、1 简报；blueprint 值为空串，

 toc/arcs 渲染成 []。rev：blueprint fc7a685c0455、toc 9b5597e18057、arcs 7a2f618d0531、briefs/0042 2667719de6c8

## 批准后的实现范围（顺序）

1. 前端文件编辑器（按拍板 2 选组件）：行号 / YAML 高亮 / 键锁装饰 / 当前行 / minimap / 状态栏 /

  revision 冲突 409 提示 / 保存

2. AI 提案卡：SSE proposal → diff 渲染 → 应用(actor=ai)/丢弃/在编辑器中打开

3. B→D 跳转：点目录里的描述值 → 打开该章简报并把光标落在对应字段

4. 我上一批浏览器批注：对话坞过高、人物卡贴照片、三栏拖拽边界、minimap 改 VSCode 风格

5. 全量验证：后端 pytest + 前端 npm run test -- --run + npm run build，起 dev server（:8000 / :5173）

  真接口跑一轮对话确认逐字流式，然后 commit + push（走代理），WORKSTREAM-PLAN 打勾

## 后续排期
能启动网页给我看一下吗

C4 TipTap 编辑器迁移 + Ctrl+F + 全量 13 组快捷键 → 框选改文接真实修改接口出双栏 Diff →

Token 用量详情页（对话/正文分开统计）→ AI 自检主动提示设定冲突并插"建议反馈"卡片

## 设计 token（浅色，帧 17 实测）

surface #FFFFFF / panel #F8F8F7 / gutter #FAFAF9 / chip #F1F1EF / border #E4E4E1 / 分隔 #D4D2CE /

正文 #1C1B1A / 次级 #73716C / 弱 #8A8680 / 注释 #A39F97 / 行号 #B7B4AE /

朱砂 #C2492F（浅 #E06A4E）/ active-line #FDF3F0 / 琥珀警示底 #FBF3E2 字 #A8811F /

删 #FDF1EF+#B03A22 / 增 #F0F7F1+#2F7A45

