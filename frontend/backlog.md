# frontend/ 更改账（最新在上）

一条一行：日期 · 批次批注 · 一句话 + 提交哈希。视觉规格在 `docs/UI-DESIGN.md`。

- 2026-09-07 · 29.7 · 开场白挂 `chat-greeting` 套思考那张脸；`MarkdownText` 加
  `className` 透传；`uiInvariants` 的 `rule()` 学会读选择器列表。`8ea15b1`
- 2026-09-07 · 29.6 · 恢复弹窗里那句解释条款删掉。`1de85d9`
- 2026-09-07 · 缺陷 · JSX 孩子位置的双斜杠注释被当文字渲染；改成 `{/* */}` 并加
  「界面文字里不许出现双斜杠」的通用防线。责任提交 `448bc67`。`9646907`
- 2026-09-07 · 29.5 · `.backup-doc` 补右内衬 14px，两行按钮逐位对齐。`be91ac8`
- 2026-09-07 · 29.4 · 树菜单「重新编号」+ `Ctrl+Alt+R` + 逐行报告确认框；
  已经连续时 disabled 并写明原因。`c4fe78d`
- 2026-09-07 · 29.3 · 思考过程流式接进 `row.meta.reasoning`，流式期间自动展开。`def07de`
- 2026-09-07 · 29.2 · 左栏「对话」列真线程；store 加 `chatConversation` 与
  `conversations`；`.tree-row.conversation` 必须 `min-width:0`，否则一句首句撑爆侧栏。`b3658b1`
- 2026-09-07 · 29.1 · 设置页按 `book_on_shelf` 分支；新增 `BackupRow` 与
  `restoreChapter` 通路。`448bc67`

- 2026-09-07 · 新建 `src/` `src/components/` `src/pages/` `src/store/` `src/utils/` 五份 `description.md`（9-12 行）与对应 `backlog.md`；本目录 `description.md` 23 → 18 行（细节下沉到子层）。**无代码改动**。
