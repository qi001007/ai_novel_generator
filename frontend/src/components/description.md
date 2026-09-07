# src/components/ —— 一块一面（32 个组件，测试同名并置）

三栏各一：`TreePane`（左栏树）/ `ChatPane` + `chatTrace.ts`（中栏对话与思考流）/
`EditorPane` + `FileEditorPane` + `cmDoc.ts`（右栏文件两面，CodeMirror 挂载在这）。
`ChatPane` 只管订阅/滚动/输入/JSX；**流事件 → 行序列的规则在 `chatRows.ts`**（纯函数，`chatRows.test.ts` 直接喂事件数组来验，不 render、不碰 fetch）。
`CharacterFormCard` 与 `CharacterDocForm` 是**同一张人物卡**的两个面，不是两张卡。
共用件：`ProposalCard` `FeedbackPanel` `MarkdownText` `TocListView` `Splitter`
`HScrollThumb` `StatusBadge` `ViewToggle` `ActivityRail`。
`cmDoc.ts` **不再自带语法表**（候选 4c）：认什么键行全看投影随文档发来的 `grammar`，按 kind 查表，
  所以「目标／起始章／结束章」在简报、弧、人物档案里各自指回自己的字段；表的主人只有一个——
  后端 `markdown_doc._GRAMMAR`。`src/grammarParity.test.ts` 钉住两件事：前端不许再长出第二把表、
  每枚键行按 kind 解析得对。**登记未做**：`CharacterFormCard`/`TocListView` 里还有硬编码中文标签
  （表单字段、剧情功能/备注），同一族欠账的下一片（候选 4d），本轮未动。
**已知未接线的壳**：`ForeshadowWall` / `WorldMapPanel` / `PaintingDetailPanel` 面板内零请求，
那是没接线不是没数据（`docs/WORKSTREAM-PLAN.md §二`），别再重复排查。

**改这里必须同批改的**：`../uiInvariants.test.ts`（断言随决定搬家，**不许删断言**）；
发请求只走 `../api.ts`；样式写进 `../styles.css`。
