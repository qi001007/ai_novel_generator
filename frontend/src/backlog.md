# frontend/src/ 更改账（最新在上）

- 2026-09-10 · 批次 35.5（D-47）：`uiInvariants.test.ts` 新增一条「an applied write follows the path the server says it landed on」（第 **55** 条）——把 `applyProposal` 整段按方法名切出来，断言含 `landed = written.path;` 与 `await get().reload(landed);`、**不得**再出现 `await get().reload(path);`、含 `delete entries[path];` 与 `new Set(state.tabs.map(` 的标签改写；段落切片本身 `length > 0`，防止改名后断言悬空。既有断言一条未删。门禁：vitest **279 passed / 26 files**（277 基线 +2 ＝ 本文件 1 条 + `store/files.test.ts` 1 例），`tsc -b --force` 退出 0，`npm run build` 通过，命中区审计（作品 6 真机页）small 0 / clipped 0 / unreachable 0 / edge 0 / srOnly 1（那颗 1×1 附件输入，与 D-45/D-46 同一份）。

- 2026-09-10 · 批次 35.4（D-46）：`uiInvariants.test.ts` 新增一条「a landed write re-reads the chapter list before its records」——钉面板源文件里 `void reloadChapterList()`、不得再出现 `void loadChapterRecords()`，并把 store 里这段动作按动作名切出来断言 `set({ briefs, chapters })` 在前、`await get().loadChapterRecords()` 在后、整段不含 `selectedChapterId`。既有断言一条未删。门禁：vitest **277 passed / 26 files**（+3），`tsc -b --force` 退出 0（首轮抓到新 stub 里两处尾逗号语法错），`npm run build` 通过，命中区审计 small 0 / clipped 0 / unreachable 0（同一份 2 条 edge + 1 条 srOnly）。

- 2026-09-10 · 批次 35.3（D-45）：`styles.css` 的 `.proposal-more` 随控件搬家改对齐——`align-self: flex-start`（它是纵向 diff 列表里的一项）换成 `margin-left: auto` + `white-space: nowrap`（头部行内靠右，且不许换行把 `.proposal-head` 撑高）。`uiInvariants.test.ts` 按 D-33 新增一条「the fold control sits above the rows it folds」：源文件里 `fold` 节点必须紧跟 `.proposal-meta` 的 `</span>` 进 `.proposal-head`、`.proposal-diff` 内不得再出现 `.proposal-more`、CSS 不得再 `align-self: flex-start`；既有断言一条未删。门禁：前端 vitest **274 passed / 26 files**（+2），命中区审计 small 0 / clipped 0 / unreachable 0（与改前同一份 2 条 edge + 1 条 srOnly）。

- 2026-09-10 · 批次 35.9（D-42）：`uiInvariants.test.ts` 新增一条不变量——「对话 Agent 轮数上限 / token 上限」两个框必须在页面上、值由 `data.agent.*` 读回、PUT 体带 `agent`；并反向读 `backend/app/services/agent.py`，把停止文案里指名的分组标题抓出来，逐个断言它真的是设置页的一个 `prefs-group-title`，防止后端说的入口和页面上的分组各说各话。既有断言一条未删。
- 2026-09-09 · 更新入口、网络边界、语法与大文件风险说明；未改源码。
- 2026-09-08 · types.ts 接收工具步骤耗时/字符数；grammarParity 防止前端重建语法表。
- 2026-09-07 · labels.ts、paneLayout.ts 等跨面单件收为各自唯一主人。
 - 2026-09-09：补充对话 Agent 的显式生成确认入口，仍走既有章节流式生成接口。
