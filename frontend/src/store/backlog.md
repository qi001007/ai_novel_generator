# frontend/src/store/ 更改账（最新在上）

- 2026-10-23 · B-02：`workbench` 新增仅递增 `workflowRefreshEpoch` 的列表刷新动作，不改选择及选择 nonce。

- 2026-10-23 · G-01/V-19：`workbench` 新增 `workflowRuns`，随章节记录一起拉取并在切书/空态/失败时清空；`workbench.test.ts` 覆盖加载与空态。
- 2026-10-23 · V-19 阻塞：`createNovel` 改走 `api.executeCommand("novel.create", …)`，不再调用旧 `POST /api/novels`；新增 `workflowSelectionNonce`，每次 `selectWorkflow` 自增，供画布区分「用户换了选择」与「草稿 id 变化」。`workbench.test.ts` 断言命令名、幂等键前缀与作品列表回读。

- 2026-10-21 · B-02：正文生成改走当前发布 Workflow 候选接口；刷新恢复候选、切书/切章隔离，接受经文件 PUT 原始 revision，并阻止覆盖本地未保存编辑；状态回归覆盖生成不改稿和接受参数。

- 2026-10-21 · F-02：提取 refreshLlmStatus 单一状态刷新动作，初次加载、保存配置与页面恢复共用；请求失败保留已知状态，不把未知状态误判为已解决。

- 2026-10-19：工作台状态增加工作流资源命令信号，使左侧资源树的重命名/设默认调用右侧同一工作流处理器；切换作品时清空命令，避免跨书串联。

- 2026-10-19：正文字号默认提高到 18px；只迁移旧默认 17px，保留用户自行选择的其他字号。

- 2026-09-11 · 批次 35.17（裁定进 **D-58**）：`files.ts` **+5/−1**——`offer()` 那枚 `tabs:` 三元多加一个条件：`restore || !proposal.valid || state.tabs.includes(proposal.path) ? state.tabs : [...state.tabs, proposal.path]`（那 −1 就是被替换掉的那一行旧条件，形状未动），上面四行注释写清理由：被闸门拒过的那一份永远画不出 diff band、应用那颗是 `disabled`、`applyProposal` 还在唯一写入口再拒一遍，所以它不配占一格。**`pending` 照旧写**——这不是遗漏而是判据：主人得看见被拒的是哪一份（红字写着缺哪几个小节）也丢得掉，卡片仍挂在他那条消息上；只是「占一格标签」这一件承诺「这里有个文件能打开」的事不再做。`files.test.ts` **+30/−0** 一条新例 `keeps an invalid proposal off the tab strip (批注 35.17)`，**两个方向都钉**：`valid:false` 后 `tabs` 与基线 `toEqual` 且 `pending[NEW]` 为真；紧接同一份改成 `valid:true` 后 `tabs` 等于 `[...基线, NEW]`——只钉前一半的话，下一个人把 `offer()` 的加格子整段删掉也能绿。**先红后绿**：改之前红在 `expected [ 'settings/characters/new.md', … ] to deeply equal [ … ]`。**反向变异**摘掉 `!proposal.valid ||` → 本文件这条 ＋ `uiInvariants` 第 18 条 **2 failed / 82 passed**，还原后 84 passed。收口：本目录 **326 passed / 27 files** 全套绿、`tsc -b --force` 退出 0。真机 A/B/C 三组数字与「刷新那一支早已被 35.20-35.22 关掉」那笔账，记在 `docs/DECISIONS.md` D-58 与 `.scratch/backlog.md`。

- 2026-09-11 · 批次 35.33（一行判据的错，不占新编号）：`files.ts` **+1/−1**——`briefChapter()` 那道正则有两个捕获组，它只读 `m[1]`，命中规范路径 `chapters/NNNN/brief.md` 时回 `NaN`（`NaN` 不是 `null`，调用方那句 `?? 0` 挡不住）。改成 `Number(m[1] ?? m[2])`，写法照同文件 `draftChapter`（`files.ts:113-115`，登记时记成 `:119-122` 是错的，那一带现在是 `BRIEF_FIELD_OF`）。`files.test.ts` **+25/−1**（净 ＋2 条 `describe("the chapter a brief path names")`：两支路径都回 7 ＋ 非简报路径回 `null`；那 －1 是导入行从一行拆成多行以免超长度），**先红后绿**：修之前量到 `expected NaN to be 7`。**反向变异**把那行改回 `Number(m[1])` → **1 failed**，还原后绿。**本条不动 `uiInvariants`（仍 62）**：它不是界面决定，断言的家在 `files.test.ts`，同一件事不在第二处钉。真机侧只做了读：5173 `/novels/5` 与 `/novels/7` 各扫一遍，整屏含 `NaN` 的叶子节点 **0 个**。**为什么界面上今天看不出来（逐本数过，别归错）**：`/api/novels/{id}/files` 会为每条 `ChapterBrief` 发一枚 `kind:"brief"` 的规范路径 meta，主人名下作品 1／2／3／4／5 各回 **1／3／2／2／10 枚**（6／7／8 各 0 枚，那几本没简报）——所以旧写法**每天都在被调用、每天都算成 `NaN`**，只是紧接着被 `chapter > 0` 丢掉、再由 `state.chapters.forEach` 用 `briefPath()` 原样重建（`WorkbenchPage.tsx:668-678`），列表因此看着是对的；再加一层结构理由：`BriefRow.hint` 在 `TreePane` 里从未被渲染（只按 `row.chapter` 找自己那一章，`TreePane.tsx:394`），所以「第 NaN 章」这五个字压根没有出口。修好之后 meta 那一路才真的赢，`WorkbenchPage.tsx:681-688` 那句求 `last` 的 reduce 此前对规范路径恒等于没读。门禁：前端 **317 passed / 26 files**、`tsc -b --force` 退出 0、`npm run build` ✓ 1.68 s。

- 2026-09-11 · 批次 35.29c（裁定进 **D-57**）：`workbench.ts` **+16/−7**——把「这一章到底有没有 D 层简报」那三级兜底（章节自己的 `brief_id` → 同号的简报 → 当前选中的那份）从 `generateDraft()` 里**原地搬出**并 `export` 成 `findBriefForChapter(chapter, briefs, selectedBriefId)`，`generateDraft()` 改成调它（那 7 行减号就是搬走的本体，判断逻辑逐字未动）。为什么要导出到 store 而不是 `ChatPane` 自己再写一遍：`/generate` 要改道去补简报还是直接写正文，问的是**同一个布尔**；两处各写一遍就是第二个主人，一旦漂移就出现「这边说还没简报要先补、那边 `generateDraft` 照样开写」。`workbench.test.ts` 本条 **+0**（`generateDraft` 既有的三条断言一行未改仍绿，它守的行为没变）；本目录无其他文件改动。门禁：前端 **315 passed / 26 files**、`tsc -b --force` 退出 0。

- 2026-09-11 · 批次 35.30（裁定进 **D-53**）：`workbench.ts` **+14/−2**——`generateDraft()` 里那句把两种原因揉在一起的「请先选择章节；该章还需要一份 D 层简报」（责任提交 `4243328`）拆成两句，每一句都带着**可以照抄的下一步**：没选中章节 →「还没选中章节：在左边点一章，或输入 /generate N 生成第 N 章」，N 取自 `chapters[0].chapter_number`（这本书真实存在的那一章，不写死示例；一章都没有时改口「这本书还没有章节：先在 B 目录里建一章」）；选中了但缺 D 简报 →「第 N 章还没有 D 层简报：先说「给第 N 章写一份简报」，应用卡片后再 /generate N」。**判据第三句就是这条的存在理由**：真选中了章节的时候，屏幕上不该再出现「请先选择章节」五个字。`workbench.test.ts` **+25/−0** 两条新例，既有的 `generateDraft` 断言一条未删。真机（5173 ＋ 作品 7 `probe1`，10 章 0 简报，零额度零写入）：`/generate` →「第 1 章还没有 D 层简报：…后再 /generate 1」；关掉全部章节页签后 `/generate` →「还没选中章节：在左边点一章，或输入 /generate 1 生成第 1 章」。

- 2026-09-10 · 批次 35.22（裁定进 **D-51**，提交 `5254edf`）：`files.ts` **+12/−4**——`offer(proposal, opts?)` 新增 `{ restore?: boolean }`。`offer()` 是实时流与历史恢复**共用**的那一个动作，从前它除了写 `pending` 还无条件 `tabs.push(path)`、并在 `path === toc.md` 时抢焦点、拉揭示、补 `open()`（那半是 2026-09-09「offer 对 toc.md 提案自动前置打开文件」那条带来的，当时只有流式一条路，看不出代价）。于是主人刚关掉的标签在下次挂载（进出 `/settings` 就是一次挂载）被重新加回来。现在 `restore: true` 一支只写 `pending`：不加标签、不抢焦点；把文件端到前面仍是主人的手势（「在编辑器中打开」）。实时流那一支不带 `restore`，行为逐字未变（D-49）。`files.test.ts` **+23/−0** 新例钉「恢复一张卡而不动主人理好的标签条」，并断 `active` 没被换掉。真机（作品 6 ＋ 副本库）：改前 关标签后 标签 3／卡 0／dot 0 → 进出设置 **4／1／1**（那张卡还是 `invalid`）；改后冷启动 0／0。

- 2026-09-10 · 批次 35.5（裁定进 D-47）：`files.ts.applyProposal` 不再假设「写入落点＝卡片上的路径」，改取 `written.path` 作 `landed`，随后的 `reload(landed)`、pending 清理、`entries`/`tabs`/`active` 全部对 `landed` 说话；`landed !== path` 时删掉模板那条缓存条目、把标签位原地换成数字档案（`new Set` 防同名重复）。这条差别只在**新建**类写入上出现（`settings/characters/new.md` 回来的是 `settings/characters/8.md`），而编号的归属权在服务器（D-02）。`files.test.ts`：默认 `writeFile` 桩原先把所有写入的返回路径写死成 `BLUEPRINT_PATH`（值 `blueprint.md`）——那是一台会说谎的假服务器，正好遮住了这个缺陷；改成回显请求路径，另加 `follows the numbered path a character create actually lands on` 一例断言模板条目被删、标签与 active 换成 `7.md`/`8.md` 那条。

- 2026-09-10 · 批次 35.4（裁定进 D-46）：`workbench.ts` 新增 `reloadChapterList()`，作为左树两份来源（`/planning/briefs` + `/chapters`）唯一的重读入口，**先重读清单、后 `await loadChapterRecords()`**——顺序是这条的正文：`loadChapterRecords` 拒绝为一份它在清单里落不了位的章节取记录，所以「第一章刚被创建、清单还空」那种情况它连请求都不发。后台重读不写 `selectedChapterId` / `selectedBriefId`，主人正在看谁就不动谁。`workbench.test.ts` +2 例（重读两源且不动选择；未选作品时不发任何请求）。

- 2026-09-09 · 提案写入后先确认 Markdown 重载成功再清除 pending，补 B 层应用后同步回归。
- 2026-09-09 · files.offer 对 toc.md 提案自动暂存到目录视图并前置打开文件；应用前仍不写入服务端。

- 2026-09-09 · 明确三个状态持有者与跨 await 竞态规则；未改源码。
- 2026-09-07 · workbench 接章节删插/改名/重排、线程选择与记录刷新；files 统一正文 buffer。
- 2026-09-06 · appearance 成为外观属性唯一写者。
