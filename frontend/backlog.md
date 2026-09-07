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
- 2026-09-07 · 架构走查候选 5：新增 `src/labels.ts`（TASK_LABELS/KIND_LABELS/PROVIDER_TASKS）与 `src/utils/time.ts`（formatTime），删掉 `EditorPane`、`GenerationRunDetailPage` 两份逐字相同的 TASK_LABELS + formatTime、`GenerationRunDetailPage` 的 KIND_LABELS、`PreferencesPage` 那份口径不同的 TASKS 表（同一个 review 那儿叫「审稿」）。**命名裁定**：A 层统一「全书蓝图」（D-34）——`TreePane` 树标签、`contextLayers.ts` 反查 key（原写「全本蓝图」＝死项）、6 个测试 fixture 一起对齐。uiInvariants 两条断言按 D-33 搬到新主人（条数不减）并反向钉「组件不许再建表」。关掉 UI-BACKLOG §一 那条「同一份资料两个名字」。238 passed / tsc clean / build ok。
- 2026-09-07 · 架构走查候选 7 第一片：新增 `src/paneLayout.ts`（7 个宽度常量逐字搬来 + `chatMaxAt`/`clampPaneAt`/`defaultPanesAt` 三个纯函数，视口作入参；算式里的裸数字 44/2 命名成 `RAIL_WIDTH`/`SEAM_WIDTH`）。`WorkbenchPage` 的两个算术函数降级成薄包装，**25 个调用点一个没改**。`WorkbenchLayout.test.tsx` 不再自己重抄 `SIDEBAR_DEFAULT = 300`（第三主人消失）；uiInvariants 两条钉语句的断言按 D-33 搬到新主人并 +2 条（含反向钉：组件里不许再出现 `const EDITOR_MIN`）。新增 `paneLayout.test.ts` 4 组数据测试。变异自检三条：把 `chatMaxAt` 换回当年那版「固定预留 560」→ 3/4 红（承重）；但把内层 `Math.min(CHAT_MIN, max)` 去掉、或把 `min/max` 嵌套顺序颠倒 → **仍然全绿**，说明这条公式里有一层冗余防御（外层封顶已经吸收了它）。**我没顺手删它**：那是行为中性的简化，该单独一条做并留测试证据。242 passed（238 → 242）/ tsc clean / build ok。**未做**：把 viewport 一路传进拖拽逻辑（`dragDelta`/`editorWidthIf` 仍直接读 window），以及 `ChatPane` 44/180 与 `styles.css` 44/220 那对同事实两个数。
- 2026-09-07 · 候选 7b：`editorWidthIf` 与 `dragPane` 也收成纯函数 `editorWidthAt` / `dragValueAt`，`window.innerWidth` 从这两处算术里退出；轨道里的裸 44px 改用 `RAIL_WIDTH`，缝命名成 `SEAM`（`SEAM_WIDTH = SEAM * 2`，数值不变）。paneLayout.test 4 组 → 6 组（拖动地板=CLOSE_AT、隐藏列不占位）。变异自检：让隐藏列也占位 → 623 变 625 立刻红。我自己把期望值算错一位（1094 应为 1095），改的是测试不是代码。244 passed / tsc clean / build ok。未搬：`toggleHidden` 的 room（要连着隐藏态判，留 7c）、`ChatPane` 44/180 与 `styles.css` 44/220 那对同事实两个数。
- 2026-09-07 · 候选 4a（投影语法两把表）：`cmDoc.ts` 补上后端会打而前端不认的 12 枚标签——伏笔的埋设章/预计收章/已收章/内容、世界观的类别/已确认/来源章/现况/内容、人物的姓名/分级，以及 field->label 方向的expected_start_chapter/expected_end_chapter。**效果**：世界观、伏笔墙、人物档案在编辑器里重新被认成结构行（导轨锁定 + focusField 可跳 + 面包屑不再显示英文字段名）。新增 `src/grammarParity.test.ts` 4 条对照测试：逐对读后端 `markdown_doc.py` 的 8 张表 39 对，钉「后端打得出的标签前端必须认得」，并把三处 label→field 撞车（目标/起始章/结束章）列成 KNOWN_AMBIGUOUS 清单，再多一处就红。为测试导出 HEADING_FIELDS/BULLET_FIELDS（只读用途）。两个本机坑记在测试注释里：core.autocrlf 让 node 读到的 .py 是 CRLF（必须归一，否则正则空跑）；我那条防空跑的守卫真的拦下了一次 0 表绿灯。变异自检：抽掉一枚标签 → 立刻红。248 passed（244 → 248）/ tsc clean / build ok。**未做**：让后端随投影把表发下来、前端不再自带一份（候选 4b）。
- 2026-09-07 · 候选 4b（后端侧，前端未消费）：`markdown_doc.grammar_for_kind()` 从既有元组派生每个 kind 的字段↔标签表（**不另抄标签**）；`FileDoc` 加 `grammar` + `with_grammar()`，`routers/documents.py` 单点填表、`FileDocOut` 声明该字段；前端 `types.ts` 的 FileDoc 镜像加可选 `grammar`。新增 `backend/tests/test_projection_grammar.py` 3 条：7 个 kind 都发得出表、标签不得来自第二份抄写、响应模型少声明字段就红（内存变异验证：删掉 grammar 声明立刻红）。273 passed（270 → 273）/ 前端 248 不变 / tsc clean。**cmDoc 那份本地表仍在**，删它是 4c，工单已写进 `src/components/description.md`。（补记：上一条幂等守卫写成了「候选 4b」，而 4a 那条账里已经出现过这个词，所以第一次追加被自己的守卫挡掉了——守卫要用本条独有的串。）
