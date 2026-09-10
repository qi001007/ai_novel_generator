# frontend/src/components/ 更改账（最新在上）

- 2026-09-10 · 批次 35.27：`chatTrace.ts` **+22/−2**、`ChatPane.tsx` **+1/−1**。后端现在会把模型当正文吐出来的 `propose_toc` payload（```json 里的 `{"chapters": […]}`）编译成一张 `toc.md` 卡，可落库正文里那道 JSON 还留着——同一份文件在屏幕上出现两次，正是 D-51 拦的那件事。`stripProposalFences(text, proposals)` 多收一个参数，剥除条件是后端那两个条件的镜像：这一行**有** `toc.md` 卡（`TOC_PATH` 从 `../store/files` 引，不再自造字面量）**且**正文里没有 `@toc.md` 围栏（`TOC_FENCE_OPEN`）。块体用 `[^`]*` 匹配，JSON 里不会有反引号，所以一道块绝不会跨过自己的收尾去吃下一道；摘不摘还要看块体里有没有 `"chapters"`，不是提案形状的 json 块原样留着。没有卡时 `promoted` 为假，编译器拒掉的那段一个字都不会少。`chatTrace.test.ts` **+29**（出卡即摘／无卡不摘／已有 `@toc.md` 围栏时不摘／非 chapters 形状不摘）。

- 2026-09-10 · 批次 35.26（提交 `e9638fc`，本条为补记——那次提交只带了源文件，漏了这一目录的账）：`MarkdownText.tsx` **+49**、`MarkdownText.test.tsx` **+36**。`.chat-md` 那张形状表里没有表格这一支，主人第 70 条回答那份三列五行的方案表于是以 `|` 与 `---` 原样摊在屏幕上（「看来你现在的对话页面并不支持列表的形式」）。新增 `TABLE_SEPARATOR`（认分隔行，兼容 `|---|:--:|`）与 `cells()`（掐首尾竖线再切，逐格 `trim`），扫描循环里紧接围栏分支之后加一条表格分支：表头那一行加下一行是分隔行才成立，之后连续含竖线的行都进表体，**格内仍走 `inline()`**，所以 `**B 目录**` 这类标记在格子里照样成元素。判据逐条量在他那条逐字表格上：`thead th=3`／`tr=5`（thead 1 ＋ tbody 4）／`tbody td=12`／正文里含竖线的 `<p>` **0 个**，另加一条反例钉「可选 A | B 两种落点」这种句子里的竖线**不算**表格。`uiInvariants` 未动：那个文件管跨文件不变量，本条是单文件渲染能力，再 grep 一遍源码是重复登记。

- 2026-09-10 · 批次 35.20 / 35.21 / 35.22（裁定进 **D-51**，提交 `5254edf` ／ `eb59101`）：`chatTrace.ts` **+25**，新增纯函数 `stripProposalFences()`——落库正文里那道「三个反引号 + markdown + `@路径`」的围栏本来就是提案的载体（服务端每次读历史都从它重新派生提案），而 `splitTrace` 从前只剥 `[TOOL_CALL]`，于是 `MarkdownText` 把整份被提议的文件排成 `.chat-code`、提案卡再在下面逐行排一遍：同一屏两个代码框，点完应用卡片卸载而围栏留下（35.21）。`@路径` 是必需段，正文里引用的普通代码块不受影响；未闭合时整段不显示。`ChatPane.tsx` **+17/−7**：历史重放只挑 `item.valid` 的（35.20——被结构闸门拒过的永远写不进去，D-38 不因「恢复」破例），渲染改成 `splitTrace(stripProposalFences(row.text))`，恢复那一次调用带 `{ restore: true }`（35.22）。测试 `ChatPaneProposal.test.tsx` **+3 例**、`chatTrace.test.ts` **+5 例**。

- 2026-09-10 · 批次 31.4（裁定进 **D-50**）：`chatRows.ts` **+6/−2**——`toolLine` 的入参从内联 `Extract<ChatStreamEvent, { event: "tool" }>["data"]` 换成命名后的 `ChatToolStep`，函数体一行未动，文档串补一句「一个函数两个调用方」；这是「轨迹文案只有一个构造器」那半句的落点，刷新那份与流式那份走的是同一支函数，所以两行**逐字**相同。`ChatPane.tsx` **+7/−0**，只在 `fromHistory` 里给 `reads` 喂 `(row.steps ?? []).map(toolLine)`——`??` 那半是实测换来的：真机对主人那台旧 8000 量过，`/chat/messages` 回 **25 行**（13 user ＋ 12 assistant）、`anyHasSteps false`，必需字段写法下 `fromHistory` 在 map 里抛一次就整批不渲染（`agentRows 12→1`、`bodyHasHistory true→false`），补上 `??` 后同一台旧后端 **12 行都还在**、只掉这一列。`ChatPane.test.tsx` **+31/−0** 新例 `puts the tool trace back when the answer is read from history`，钉的四件事：`<ChatPane />` 拿一份带 2 步的历史行渲染，`lines` 必须 `toEqual(steps.map(toolLine))`（同源，不是转述）、抬头 `本轮读取 · 2 步`、`lines[0]` 含 `未成功`（`ok: false` 不许被洗白）、`lines[1]` 含 `1.4s`（1400ms → 一位小数）。`ChatPaneProposal.test.tsx` **+5/−0**，5 份历史行夹具各补 `steps: []`——`steps` 是可选的，不补也编译，补是为了让这 5 例显式声明「这一答本就没有轨迹」，免得将来读到空 `reads` 时分不清是缺字段降级还是真没有。**反向变异（D-33）**：M3 摘掉 `ChatPane.tsx` 那一行 → `ChatPane.test.tsx` 1 failed；M4 把 `ChatToolStep` 的 `ms`/`chars` 改回可选 → `uiInvariants` 1 failed **且** `tsc` TS18048 退出 2；两处各自还原（md5 与备份一致）后全绿。既有断言一条未删。

- 2026-09-10 · 批次 32.4（裁定进 **D-49**）：**组件代码一行未改**，只补断言。`FileEditorPane.test.tsx` **+78/−0** 新例 `lands the applied rows in the rendered list, and the same document in the source`，接在既有那例「shows a pending B-layer proposal in the rendered list without writing it」之后——两条合起来才是判据的后半句：确认前列表可以叠一层「待确认预览」但不许伪装成已写入（旧例管），确认后两屏得是同一份（新例管）。钉的四件事：`applyProposal` 返回 `true`、徽标摘掉、`.toc-row` 恰好 1 行且 `entry.draft` 等于落库那份、`pending` 清空，再 `setView(path, true)` 切到源码面断 `.cm-content` 含同一句章名。**反向变异（D-33）**：把 `store/files.ts` 的 `applyProposal` 里那句 `await get().reload(landed)` 摘掉 → 应用后列表 **0 行**（这条用例红），装回即绿，md5 与备份一致，故本条不是「前端本来就好所以随便写的断言」，它钉的是 `reload` 那一行仍在被读。**界面控件未动，故不加 `uiInvariants` 断言**（加了就是重复计数，56 条沿用 35.15）。真机侧的数字（浏览器时间线 5811ms 上屏／12 行／应用后源码面 467 字符与列表同一份）记在 D-49 与 WORKSTREAM-PLAN §8。

- 2026-09-10 · 批次 35.15（裁定进 D-41）：`chatRows.ts` 的 `AgentMeta` 加 `mode?: string`，`context` 分支 `mode: event.data.mode`、`done` 分支 `mode: meta.mode ?? message.mode`（与 `refs` 同一条「先到的赢」）；`ChatPane.tsx` 的 `fromHistory` 补 `mode: row.mode`（刷新后仍在），说话行在 `.chat-who` **之后**渲染 `按「计划」`／`按「写作」`（放后面是因为 `.chat-actions .chat-who` 带 `margin-left: auto`，放前面会把模型名推到行尾），chip 带 `aria-label` 给读屏，旧注释里「模式已经在开关上了」那句随之作废；`ChatPane.test.tsx` 新增 `runTurn` 与两例（两种模式各一行，钉 `按「计划」` 出现而开关仍勾「写作」）。真机取证走**计划态、不花主人网关额度**：5173 当前源码 + 8037（`i3516.db` 作品 6 副本），历史里本就有 `mode='plan'` 的行——量到 **13 条答案行 13 条带标签**（11 写作 / 2 计划），msg 57 与 msg 67 显示 按「计划」而同一屏 composer 勾着「写作」；chip 55×17px、右边界 `847` 恰等于行右边界（未裁切）、与模型名同一行；说话行 `opacity` 悬停前 `0`／悬停后 `1`（跟随 `.chat-actions` 既有规则，不为一个标签破例；要它常驻只需搬进行首那行）。判据原句在决策函数上直接量：`effective_mode("给第 1 章写一份简报","write") == "plan"`。截图 `3515-top.png`／`3515-plan.png`／`3515-hover.png` 亲自看过。

- 2026-09-10 · 批次 35.4（裁定进 D-46）：`FileEditorPane.tsx` 对「写入落地」的反应从 `void loadChapterRecords()` 换成 `void reloadChapterList()`。量的：应用一张合法简报提案卡后 `PUT` 已 200、`GET /chapters` 已是 1 条，而左树仍报「还没有章节」、非要手动刷新——旧调用取的是所选章的生成记录与评审，树一个字段都不读。复测（8035 + `i354.db`，0 章作品）：不刷新页面即 `chapters 0→1`、树行 `9→12`、「还没有章节」消失，与刷新后的快照逐项相同，四个标签逐个 HTTP 200。`FileEditorPane.test.tsx` 原有那例「re-reads the chapter records once a proposal has landed」**未删**，改写成这条链的完整版（清单两次 GET + 记录一次 GET + StrictMode 双跑不刷新）。

- 2026-09-10 · 批次 35.3（裁定进 D-45）：`ProposalCard.tsx` 把折叠那颗钮从 `.proposal-diff` 列表**末尾**搬成独立 `fold` 节点、渲染进 `.proposal-head`（与文件名、`AI 提案 · +N −M · 第 X 行` 同一行）。原因不是状态而是几何：真机 Edge+CDP 真鼠标点「展开全部 50 行改动」后卡片 1403px、`收起` 落在 `top=1429`，而 `.chat-messages` 可视底边 `756`，控件在视口外 **673px**，主人看到的就是「展开后没法再收起」；头部在它下方长多少行都不动，复测 `moreTop` 403→403（位移 **0px**）、展开前后 `moreVisible` 均 `true`、DOM 行数 8→50→8。双向逻辑（`setShowAll((value) => !value)` + `aria-expanded`，`c978ce3` 起）一寸未改，两个分支继续共用同一份 `changeRows`。同批 `ProposalCard.test.tsx` 新增 `pins the fold control above the rows it folds (35.3)`（先红后绿），原有两条双向断言一条未删。

- 2026-09-09 · 历史加载遇到已等同当前文件的最新提案时，同时清除同路径旧待处理卡，避免导入成功后旧红字重新出现。
- 2026-09-10 · 修复提案确认过滤：所有 proposal 进入待处理状态，只有主人点击应用才写入。
- 2026-09-10 · 对话代码块启用软换行；CodeMirror 编辑器启用 lineWrapping。
- 2026-09-10 · 目录长文本单元格改为可增长换行；渲染目录覆盖编辑区（含缩略栏），避免源码底色泄露。
- 2026-09-10 · 无效提案也展示完整 diff，便于主人审查并重新生成；应用按钮仍严格禁用。
- 2026-09-10 · 对历史提案中的“内容/起止章”可纠正别名开放应用；其他结构错误继续禁用。

- 2026-09-09 · TocListView 在 B 层提案待确认期间渲染临时目录并显示状态标识；不修改文件 buffer。

- 2026-09-09 · ChatPane rows and thinking details now use a 180ms ease-out entrance animation with reduced-motion override.

- 2026-09-09 · 精简组件地图，标明三处仍未接真实数据的面板；未改源码。
- 2026-09-08 · ChatPane 展示每步成本；cmDoc 改为消费服务端 grammar；测试 fixture 不再抄标签。
- 2026-09-07 · 对话 reasoning、工具轨迹、人物文档渲染与恢复动作完成并纳入 UI 不变量。
- 2026-09-05 · 建立提案、标签栏、三栏、焦点和控件图形语言的不可回退断言。
 - 2026-09-09：在 ChatPane 工具栏加入“确认并生成”按钮，复用现有 `/generate` 命令与 `generateDraft` 流程；不新增 Agent 写工具。
