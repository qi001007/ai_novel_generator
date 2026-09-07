# src/components/ —— 一块一面（32 个组件，测试同名并置）

三栏各一：`TreePane`（左栏树）/ `ChatPane` + `chatTrace.ts`（中栏对话与思考流）/
`EditorPane` + `FileEditorPane` + `cmDoc.ts`（右栏文件两面，CodeMirror 挂载在这）。
`CharacterFormCard` 与 `CharacterDocForm` 是**同一张人物卡**的两个面，不是两张卡。
共用件：`ProposalCard` `FeedbackPanel` `MarkdownText` `TocListView` `Splitter`
`HScrollThumb` `StatusBadge` `ViewToggle` `ActivityRail`。
**已知未接线的壳**：`ForeshadowWall` / `WorldMapPanel` / `PaintingDetailPanel` 面板内零请求，
那是没接线不是没数据（`docs/WORKSTREAM-PLAN.md §二`），别再重复排查。

**改这里必须同批改的**：`../uiInvariants.test.ts`（断言随决定搬家，**不许删断言**）；
发请求只走 `../api.ts`；样式写进 `../styles.css`。
