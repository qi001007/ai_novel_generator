# frontend/src/components/ 更改账（最新在上）

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
