# src/components/ —— 一块一面（32 个组件，测试同名并置）

三栏各一：`TreePane`（左栏树）/ `ChatPane` + `chatTrace.ts`（中栏对话与思考流）/
`EditorPane` + `FileEditorPane` + `cmDoc.ts`（右栏文件两面，CodeMirror 挂载在这）。
`ChatPane` 只管订阅/滚动/输入/JSX；**流事件 → 行序列的规则在 `chatRows.ts`**（纯函数，`chatRows.test.ts` 直接喂事件数组来验，不 render、不碰 fetch）。
`CharacterFormCard` 与 `CharacterDocForm` 是**同一张人物卡**的两个面，不是两张卡。
共用件：`ProposalCard` `FeedbackPanel` `MarkdownText` `TocListView` `Splitter`
`HScrollThumb` `StatusBadge` `ViewToggle` `ActivityRail`。
`cmDoc.ts` 的语法表与后端 `markdown_doc.py` 是**一对**，由 `src/grammarParity.test.ts` 钉着：后端会打的每枚标签前端必须认得；三处「一个标签指两个字段」的欠账列在测试里的 KNOWN_AMBIGUOUS，多一处就红（那三处要按 kind 查表才算真修完，见候选 4 的下一片）。
**4c 工单**：后端已随投影发 `grammar`（`markdown_doc.grammar_for_kind`），前端消费它并删掉 `FIELD_LABEL`/`HEADING_FIELDS`/`BULLET_FIELDS` 三张本地表——那三处标签撞车（目标／起始章／结束章）只有按 kind 查表才算真修完。
**已知未接线的壳**：`ForeshadowWall` / `WorldMapPanel` / `PaintingDetailPanel` 面板内零请求，
那是没接线不是没数据（`docs/WORKSTREAM-PLAN.md §二`），别再重复排查。

**改这里必须同批改的**：`../uiInvariants.test.ts`（断言随决定搬家，**不许删断言**）；
发请求只走 `../api.ts`；样式写进 `../styles.css`。
