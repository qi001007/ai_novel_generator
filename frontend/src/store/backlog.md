# frontend/src/store/ 更改账（最新在上）

- 2026-09-10 · 批次 35.4（裁定进 D-46）：`workbench.ts` 新增 `reloadChapterList()`，作为左树两份来源（`/planning/briefs` + `/chapters`）唯一的重读入口，**先重读清单、后 `await loadChapterRecords()`**——顺序是这条的正文：`loadChapterRecords` 拒绝为一份它在清单里落不了位的章节取记录，所以「第一章刚被创建、清单还空」那种情况它连请求都不发。后台重读不写 `selectedChapterId` / `selectedBriefId`，主人正在看谁就不动谁。`workbench.test.ts` +2 例（重读两源且不动选择；未选作品时不发任何请求）。

- 2026-09-09 · 提案写入后先确认 Markdown 重载成功再清除 pending，补 B 层应用后同步回归。
- 2026-09-09 · files.offer 对 toc.md 提案自动暂存到目录视图并前置打开文件；应用前仍不写入服务端。

- 2026-09-09 · 明确三个状态持有者与跨 await 竞态规则；未改源码。
- 2026-09-07 · workbench 接章节删插/改名/重排、线程选择与记录刷新；files 统一正文 buffer。
- 2026-09-06 · appearance 成为外观属性唯一写者。
