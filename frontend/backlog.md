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
- 2026-09-07 · 死代码清理第一刀（knip）：删 4 个**零 import** 的依赖——`codemirror` 元包、`@codemirror/gutter`（`gutter()` 实际来自 `@codemirror/view`）、`@codemirror/lang-yaml`、`@codemirror/lint`；`npm install` 随之剪掉 10 个包。删 `store/files.ts` 的 `TREE_LABEL`（全仓零引用，顺带少一处「全本蓝图」命名出处）。把 10 个「只在本文件内被用」的导出降级为模块私有：`cmDoc.ts` 6 个、`minimap.ts` `MM_PITCH`、`contextLayers.ts` `LAYER_ORDER`、`appearance.ts` `UI_SIZE_DEFAULT`/`writeAppearance`——**是收回公开面，不是删代码**。`types.ts` 顶部写明「后端 schema 的镜像、允许零引用」，11 个类型全部保留。验证：226 passed / `tsc -b --force` clean / build 成功（改前改后测试数一字不差）。
- 2026-09-07 · 候选 3 前端侧：`api.ts` 四处重复的错误规范化收成一个 `apiFailure()`，失败对象带上 `status`/`code`；`store/files.ts` 写冲突判据从正则匹配中文改成 `errorCode(cause) === "write_conflict"`；`runExport` 的降级判据改成 `export_dir_not_set`。三处测试 mock 改为带码（断言条数不减）。uiInvariants 新增 1 条反向钉并做变异自检（改坏立刻红）；期间踩了 29.6 那个老坑——注释里复述被禁字面量，被自家断言抓住。227 passed / tsc clean / build ok。
- 2026-09-07 · 候选 2 前端侧：`api.ts` 两份只差类型参数的 reader 循环收成 `pumpSse<E>(response, onEvent)`（`getReader()` 从 2 次变 1 次）。uiInvariants +1 条钉住（getReader / TextDecoder 各 1 次、pumpSse 恰好两个调用者）。227 passed / tsc clean / build ok。
- 2026-09-07 · 架构走查候选 6 第一片：`ChatPane.tsx` 的 `applyEvent`（8 个事件分支）连同 `Row`/`AgentRow`/`AgentMeta`/`CommandStatus` 四个类型抽成纯 module `chatRows.ts`；组件里只留三个副作用，且留在 `setRows` 更新函数**外面**（放进去会被 StrictMode 跑两遍）。新增 `chatRows.test.ts` 9 条数据驱动测试（reasoning 先到、done 不抹工具轨迹、refs 先到的赢、error 用 partial、end 不翻案…），变异自检：把 done 改成抹 reads 立刻红。**一处等价性我改回过**：error 分支起初顺手写成「无 partial 时保留已流出文字」，与搬前不等价，已按原文改回。uiInvariants +1 条钉「规则不许回到组件里」。238 passed（原 228）/ tsc clean / build ok。**未搬**：`offerFromStream` 的提案基线判定与 `ask` 的收尾，下一片。
