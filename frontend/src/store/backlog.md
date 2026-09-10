# frontend/src/store/ 更改账（最新在上）

- 2026-09-11 · 批次 35.30（裁定进 **D-53**）：`workbench.ts` **+14/−2**——`generateDraft()` 里那句把两种原因揉在一起的「请先选择章节；该章还需要一份 D 层简报」（责任提交 `4243328`）拆成两句，每一句都带着**可以照抄的下一步**：没选中章节 →「还没选中章节：在左边点一章，或输入 /generate N 生成第 N 章」，N 取自 `chapters[0].chapter_number`（这本书真实存在的那一章，不写死示例；一章都没有时改口「这本书还没有章节：先在 B 目录里建一章」）；选中了但缺 D 简报 →「第 N 章还没有 D 层简报：先说「给第 N 章写一份简报」，应用卡片后再 /generate N」。**判据第三句就是这条的存在理由**：真选中了章节的时候，屏幕上不该再出现「请先选择章节」五个字。`workbench.test.ts` **+25/−0** 两条新例，既有的 `generateDraft` 断言一条未删。真机（5173 ＋ 作品 7 `probe1`，10 章 0 简报，零额度零写入）：`/generate` →「第 1 章还没有 D 层简报：…后再 /generate 1」；关掉全部章节页签后 `/generate` →「还没选中章节：在左边点一章，或输入 /generate 1 生成第 1 章」。

- 2026-09-10 · 批次 35.22（裁定进 **D-51**，提交 `5254edf`）：`files.ts` **+12/−4**——`offer(proposal, opts?)` 新增 `{ restore?: boolean }`。`offer()` 是实时流与历史恢复**共用**的那一个动作，从前它除了写 `pending` 还无条件 `tabs.push(path)`、并在 `path === toc.md` 时抢焦点、拉揭示、补 `open()`（那半是 2026-09-09「offer 对 toc.md 提案自动前置打开文件」那条带来的，当时只有流式一条路，看不出代价）。于是主人刚关掉的标签在下次挂载（进出 `/settings` 就是一次挂载）被重新加回来。现在 `restore: true` 一支只写 `pending`：不加标签、不抢焦点；把文件端到前面仍是主人的手势（「在编辑器中打开」）。实时流那一支不带 `restore`，行为逐字未变（D-49）。`files.test.ts` **+23/−0** 新例钉「恢复一张卡而不动主人理好的标签条」，并断 `active` 没被换掉。真机（作品 6 ＋ 副本库）：改前 关标签后 标签 3／卡 0／dot 0 → 进出设置 **4／1／1**（那张卡还是 `invalid`）；改后冷启动 0／0。

- 2026-09-10 · 批次 35.5（裁定进 D-47）：`files.ts.applyProposal` 不再假设「写入落点＝卡片上的路径」，改取 `written.path` 作 `landed`，随后的 `reload(landed)`、pending 清理、`entries`/`tabs`/`active` 全部对 `landed` 说话；`landed !== path` 时删掉模板那条缓存条目、把标签位原地换成数字档案（`new Set` 防同名重复）。这条差别只在**新建**类写入上出现（`settings/characters/new.md` 回来的是 `settings/characters/8.md`），而编号的归属权在服务器（D-02）。`files.test.ts`：默认 `writeFile` 桩原先把所有写入的返回路径写死成 `BLUEPRINT_PATH`（值 `blueprint.md`）——那是一台会说谎的假服务器，正好遮住了这个缺陷；改成回显请求路径，另加 `follows the numbered path a character create actually lands on` 一例断言模板条目被删、标签与 active 换成 `7.md`/`8.md` 那条。

- 2026-09-10 · 批次 35.4（裁定进 D-46）：`workbench.ts` 新增 `reloadChapterList()`，作为左树两份来源（`/planning/briefs` + `/chapters`）唯一的重读入口，**先重读清单、后 `await loadChapterRecords()`**——顺序是这条的正文：`loadChapterRecords` 拒绝为一份它在清单里落不了位的章节取记录，所以「第一章刚被创建、清单还空」那种情况它连请求都不发。后台重读不写 `selectedChapterId` / `selectedBriefId`，主人正在看谁就不动谁。`workbench.test.ts` +2 例（重读两源且不动选择；未选作品时不发任何请求）。

- 2026-09-09 · 提案写入后先确认 Markdown 重载成功再清除 pending，补 B 层应用后同步回归。
- 2026-09-09 · files.offer 对 toc.md 提案自动暂存到目录视图并前置打开文件；应用前仍不写入服务端。

- 2026-09-09 · 明确三个状态持有者与跨 await 竞态规则；未改源码。
- 2026-09-07 · workbench 接章节删插/改名/重排、线程选择与记录刷新；files 统一正文 buffer。
- 2026-09-06 · appearance 成为外观属性唯一写者。
