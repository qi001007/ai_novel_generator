# frontend/src/components/ 更改账（最新在上）

- 2026-10-23 · B-03：Workflow 工具栏显式绑定已发布非当前流程；未发布禁用并说明发布要求，图与保存版本不同时阻止绑定并保留画布；跨目标右键拒绝时恢复树选中，`selectedWorkflowId` 变化不再隐式重读覆盖草稿；新增四项行为回归及 UI 不变量断言。

- 2026-10-23 · B-02：TreePane 在列表加载后为缺用途显示补齐按钮，命令成功仅刷新列表 epoch，保留选中流程并以 Toast 回报未配置模型。

- 2026-10-23 · B-01：Workflow 左树选中/重复点击及右键「打开」均通知工作台切到画布，仍只编辑选择、不改默认绑定；StrictMode 切书回归与 `uiInvariants.test.ts` 锁定该入口。
- 2026-10-23 · G-01/V-19：`EditorPane` 的「调用记录」先列该章真实 Workflow 运行行（用途/时间/模型/token/详情），并与旧 `chapterRuns` 并列；无记录时才显示空态。`EditorPane.test.tsx` 覆盖跨章过滤与详情跳转。
- 2026-10-22 · M-01：新增 `MapCanvas`（适配/缩放/拖拽、格子选择、四向扩图、非对齐说明、4×4 禁用）；`PaintingDetailPanel` 接入网格、单格重绘、扩图/重绘费用弹窗与历史操作标签；定向测试 9 条通过。修 `ContextWorkflowPanel.test.tsx` 的 React Flow 替身缺 `fitView` 导致 25 条未捕获异常，全量恢复退出码 0。
- 2026-10-22 · M-02：`WorldMapPanel` 接真实列表/空态/入口；新增 `MapGenerateDialog`（StrictMode 下只以落地的提示词回填为已加载）；`PaintingDetailPanel` 生成新版本后选中新草稿而非旧确认版；三组定向测试 9 条。
- 2026-10-21 · B-02：EditorPane 以共享弹窗审核持久候选，关闭保留/接受才写稿；ChatPane 回执指向候选而不再声称已覆盖正文，回归保持生成结算与交接行为；桌面与 620px 实测截图。

- 2026-10-21 · F-06：稳定 React Flow 选中回调，同一选择不再持续重渲染阻塞路由；StrictMode 复现测试从 13 次回调失败变为稳定通过，真实画布返回书架通过。
- 2026-10-21 · F-02：ChatPane 配置提示可关闭，确认配置解决后自动移除，后续再次缺项可重新提示；提示文案覆盖连接与任务模型。
- 2026-10-21 · F-03：文件编辑 Minimap 跟随源码字体；源码及行号字号/行高在共享样式令牌统一。
- 2026-10-21 · F-04：节点创建收进工具栏单个菜单并复用画布右键清单；加入菜单边界定位、键盘导航、Escape、唯一节点与撤销回归。
- 2026-10-21 · F-05：画布缩放与适配使用共享 IconButton 控件组，单个背景、裁切边界与中文可访问标签；移除默认控件外层阴影和重复适配入口。

- 2026-10-20：Workflow 删除缩略图与整图 JSON，只显示六类已实现节点；补齐初始节点尺寸、点击选中属性面板、节点右键操作、全屏与模型组合框，并用真实画布边界计算适配视口，修复节点被推到底边。世界观改为结构化资料库，反馈收口为整书备注，编辑器接通错别字、自检和终审状态。

- 2026-10-19：V-18 候选修复：Workflow 缩略图增加实时视口框，移除整图 JSON 入口但保留节点源码；上下文模块支持多个可拖动非模态窗并记住会话内位置；文件标签改为“章节号 · 类型”且保留完整路径提示。

- 2026-10-19：Workflow 新建、保存、发布及左树的重命名/设默认均调用统一命令；成功响应携带新 revision 并刷新左右两侧同一资源状态。
- 2026-10-19：V-17 候选修复：Minimap 恢复可见缩略文字和悬停视口；一级栏合并人物/世界入口；Workflow 使用左侧资源树与右键管理、紧凑工具栏、模块浮层、真实图形缩略图和已验证节点白名单。

- 2026-10-19：正文与 Markdown Minimap 改为固定行距的可滚动缩小文档，视口块悬停/拖动才出现并支持滚轮；Workflow 改成实时节点变化、自定义选择器、创建/重命名、全屏画布、节点源码编辑器和可折叠/调高策略区。

- 2026-10-19：Minimap 跳转在下一动画帧按 CodeMirror 更新后的 `scrollHeight` 再对齐一次，修复长文首次跳转时因虚拟布局重估导致中点点击停在约 46% 的偏差；正文与 Markdown 两个编辑器一致。

- 2026-10-19：正文与文件编辑器继续共用一套 Minimap 几何和绘制器；真实页面将轨道扩到 88px，并验证拖动 500px 可同步正文与视口遮罩。

- 2026-10-19：中栏 ChatPane 接入持久化 AgentRun；高风险统一命令显示真实 diff 与批准/拒绝卡，刷新后通过 ToolCall 读回最新审批状态；新增行为测试与 UI 不变量。

- 2026-10-18：删除误加的 `LauncherAgent` 组件；平台测试与操控改由开发侧 MCP 承担。

- 2026-10-18 · 左侧活动栏扩展为文章结构、设定库、人物库、世界库、地图库、Workflow 与对话记录；人物和 Workflow 进入右栏，中间对话保持挂载。

- 2026-10-18 · 新增 Workflow JSON CodeMirror 编辑器与发布/运行前端契约，为画布与源码双向同步提供单一图数据源。

- 2026-09-16 · U-05 首版：正文页迁到 CodeMirror（仍只读写共享 `draft.md` 缓冲），`proseReview.ts` 用真实 mark decoration 标出可定位的 AI 建议；点击打开可编辑的批注侧栏，应用只替换仍匹配上下文锚点的原文并提示 Ctrl+S，失效锚点禁用应用，忽略/应用状态通过 review suggestion PATCH 保存。`EditorPane` 定向 9 条、浏览器重载（1 个 `.cm-editor`、0 个 textarea、控制台错误 0）已验；真实模型建议数据仍待下一轮 AI 自检验收。

- 2026-09-15 · CharacterFormCard/CharacterDocForm 从人物 Markdown 读取并渲染任意自定义 `##` 小节，编辑仍回到同一文件 PUT。

- 2026-09-15 · 当前章调用记录隔离与首次展开反馈：`EditorPane` 在渲染层再次按 `chapter_id` 过滤调用记录，并在展开但尚无异步记录时显示空态列表，避免第一次点击没有可见反馈；新增 `EditorPane.test.tsx` 两条用例覆盖空态即时展开和跨章节记录不串。未提交，待主代理统一验收。

- 2026-09-15 · 批注 11：文件标签栏的源码/渲染切换控件继续固定在滚动区外，并增加不可压缩宽度、覆盖层，长标题或大量标签滚动时按钮仍保持可见可点击；同步 `styles.css` 与 `uiInvariants` 断言。待前端真机长标题点击验收。

- 2026-09-11 · 批次 35.34（裁定进 **D-59**）：`ChatPane.tsx` **+38/−2**、`chatRows.ts` **+22/−0**。① `fromHistory` 新增 `command` 分支：`role==="command"` 的行渲染成 `.chat-card.command`（一张只读状态卡，显示命令名、状态、结算文案），不进 `agentRows`、不进 `reads`。② 流式期间 `subscribe` 里收到 `command` 事件时走 `setRows` 插入一条 `role:"command"` 的行（与既有 `delta`／`tool`／`proposal` 事件同一套更新通道），结算事件来时按 `run_id` 找到同一行覆写 `content` 与 `command_state.status`——`running` 状态只在内存里，**不**触发 `setRows`（守卫在 `ChatPane.tsx:396`，`if (status === "running") return`）。③ `chatRows.ts` 新增 `commandRow()` 纯函数（构造 command 行对象）与 `updateCommandRow()` 纯函数（按 `run_id` 找到行并覆写），组件里不内联这些逻辑（与「keep the row rules out of the component」同族）。**反向变异（D-33）**：M3 摘 `fromHistory` command 分支 → 2 failed（历史恢复用例 ＋ `uiInvariants` 第 66 条）；还原后 **330 passed / 27 files**。

- 2026-09-11 · 批次 35.36（结案行在 `docs/WORKSTREAM-PLAN.md`）：`ForeshadowWall.tsx` **+3/−2**、`WorldMapPanel.tsx` **+2/−1**、`PaintingDetailPanel.tsx` **+3/−2**。四枚「看起来能用、点了不响应」的按钮改成裸 `disabled` ＋ `title="暂未开放"`（照 `BookshelfPage.tsx:742` 既有写法）：伏笔墙「AI 自检」与地图「AI 生成地图」原是 `disabled={!novelId}` 而**根本没有 `onClick`**，绘画详情「下载」「设为参考」连 `disabled` 都没有。**`novelId` 一处删一处留**：伏笔墙里它只为那个假条件存在，摘掉按钮就没人用它了（调用点 `WorkbenchPage.tsx:986` 同步）；世界观地图里下面那颗「查看绘画详情（页面壳）」还在用它拼真路由，留着。本条不建任何被后置的能力。

- 2026-09-11 · 批次 35.31（结案行在 `docs/WORKSTREAM-PLAN.md`）：`chatRows.ts` **+9/−0**、`ChatPane.tsx` **+11/−12**。已经逐字应用过的那一份 `{"chapters":…}` 仍摊在气泡里成一个代码框——D-51 的摘除条件读 `row.proposals`，而 `offerFromStream` 的丢弃分支（`discardFile` 后直接 `return`，自 `b6a4acd`）从来不填它，于是那一行的记录是空的、条件永不成立。**行规则的家在 `chatRows.ts`**（`uiInvariants` 里那条「keep the row rules out of the component」），所以新增导出的 `attachProposal(rows, id, proposal)`，把两处重复的 `rows.map(...)` 收成一个；`ChatPane.tsx` 里 `proposal` 对象**提到 discard 判断之前**构造，丢弃分支变成 `discardFile(...)` → `setRows(prev => attachProposal(prev, rowId, proposal))` → `return`，末尾那一支同样换成调它。**卡片一张没多**（35.20 的判据不破：`offerFile` 仍不调用），变的只是这一行不再失忆。**测试**：`ChatPaneProposal.test.tsx` **+87/−0** 两条——已应用那一份 `pre` 数 0 且气泡文本不含 `"chapters"`、两句人话仍逐字在；未应用那一份（服务器文本改成与提案不同）照旧挂 `.proposal-file` 卡且 `pre` 0。先红后绿，红的时候量到 `expected <pre>… to have a length of +0 but got 1`；反向变异摘掉 discard 那一次 attach → **2 红**（行为用例 ＋ `uiInvariants` 第 63 条）。**真机**（5173 ＋ 8000 ＋ 作品 7 已落库那条线程，零额度零写入）：`pre` **2 → 1**、`"chapters"` 命中 **1 → 0**、`.chat-card` **5 → 5**、`.proposal-file` **0 → 0**，出图 `probe/pre-3531-n7.png`／`-toc.png`／`-blueprint.png` 与近景裁剪 `pre-3531-clip.mjs` 亲自看过；剩下那一个 `pre`（462×518，A 层 `main_line`）**不在本条判据里**，登记成 35.35。

- 2026-09-11 · 批次 35.29c（裁定进 **D-57**）：`ChatPane.tsx` **+109/−22**、`ChatPane.test.tsx` **+155/−0**。① 两个 ref ＋ **一份订阅**：`briefHandoff`（记这一棒是哪一章、哪一行）与 `autoLand: Set<string>`（本轮被允许自动落笔的路径），`useWorkbench.subscribe((state, previous) => …)` 里判 `state.briefs !== previous.briefs` 且**那一章真有了简报**才起棒，起棒前先把 `briefHandoff.current` 置空再 `void continueAfterBrief(handoff)`——订阅挂在 ref 上，StrictMode 双跑时两个监听器读同一个 ref、先到的清空、后到的 return，续写只发生一次（**不用**「布尔 flag 忽略首执行」那种真机会失效的写法）。② `offerFromStream(…, opts?: { restore?: boolean; autoLand?: boolean })`：落笔条件扩成 `(draftChapter(path) !== null || opts?.autoLand === true)`，且 `applyProposal` 成功后**只有 autoLand 那一支**补一句 `await useWorkbench.getState().reloadChapterList()`——右栏那格重读只挂在文件页签（`WorkbenchPage.tsx:987`），`/generate` 跑的时候人在正文页，不重读简报永远不「出现」、接力停在半路。③ `/generate` 分支改道：判缺用 `findBriefForChapter(target, live.briefs, live.selectedBriefId)`（与 `generateDraft()` 同一把尺子），缺就 `autoLand.current.add(path)` → 命令行落「先补简报，它一落地就自动接着写正文」→ `ask(合成那句)` → **回来立刻** `autoLand.current.delete(path)` → return。④ 结算文案抽成 `settleGenerate(id, errorBefore)` 一处（`/generate` 自己走完 与 `continueAfterBrief` 走完 都调它），三种失败各有下一步。⑤ `ask()` 里 `chapter_id` 改成 `useWorkbench.getState().selectedChapterId` **即时读**——接力那一轮 `openChapterTab()` 之后闭包里那个旧值是上一轮的，注入的会是错那一章的资料；这一改把 `selectedChapterId` 那个局部变孤儿，`noUnusedLocals` 逼着删（`briefHandoff` 那段注释里写清为什么删）。**两条新用例**：A 用 `streamGate`／`releaseStream` 把聊天 SSE 卡在手里，逐字量「合成那句问了什么（含 `propose_chapter_brief`、含「还没有 D 层简报」）→ PUT **恰好 1 次** `chapters/0001/brief.md` → 屏上 `.proposal-file` **0** → 那一行改口 → `/chapters/from-brief/8/stream` 起来 → 结算「第 1 章《第一章》· 8 字 · 机械校验 通过」；B 钉住**边界**：普通一轮里同一张简报提案**只挂卡、不动笔**（`writes` 为 `[]`）。**三条踩过的坑**：① 陈旧闭包（上面⑤）； fixture 里服务器返回的简报文本一度写成与提案**同一份**，`applyProposal` 判「已逐字应用过」直接 discard，测试拿到 `writes: []` 还像是通过——拆成 `briefDocOne`（空模板、`revision:"r1"`）与 `briefProposed` 才测到真路；③ 想在 fetch mock 里读 `document.body.textContent` 拿那一行的文案，读到的是**批处理前**的渲染，改成测试侧用一个 promise 门控流、显式 release 才有确定时刻。**真机**（5174→8010→`3529c.db`→8124 桩，零额度）：`POST /chat/stream` 1 次 → `PUT .../brief.md` **恰好 1 次** → `POST /chapters/from-brief/1/stream` 1 次、`.proposal` 卡五次采样全 **0**、右栏 34 字（流中）→ 56 字（结算），截图 `g3529c-1500s/3000s/4500s.png` 亲自看过。**门禁**：还原后 **315 passed / 26 files**、`tsc -b --force` 退出 0、`npm run build` ✓ 1.76 s；反向变异 ① 摘 `reloadChapterList()` → 2 红、② 摘 `autoLand.current.add(path)` → 2 红。

- 2026-09-11 · 批次 35.29b（裁定进 **D-56**）：`ChatPane.tsx` **+14/−13**。① 撤掉工具栏那颗「确认并生成」（`c978ce35`，2026-09-09 我自己造的）连同 `aria-label`／`chat-generate-confirm`／`title` 三个部件，原地留一段注释说明它守的那条路本来就逐字流式、发起生成只剩 `/generate`；`<span className="spacer" />` 顶上，工具栏几何不空拍。`busy` 与 `selectedChapterId` 各还有别处用（`:733` 斜杠表 / 请求体），没造死代码。② `offerFromStream` 在 `proposal` 之后、`setRows` 之前插一道自动落笔：`if (proposal.valid && !opts?.restore && draftChapter(proposal.path) !== null) { offerFile(proposal); if (await useFiles.getState().applyProposal(proposal.path)) return; }`——合法且命中四位章号的正文围栏**不再挂卡、不再等那一次点击**，写的仍是唯一那条 `PUT`（`actor:"ai"` ＋ 刚读回的 `base_revision`），只是触发者从鼠标换成程序；`!opts?.restore` 是硬守卫，刷新恢复只把卡放回，否则会把主人之后框选改过的字再盖一遍；`applyProposal` 回假就往下走把卡挂回去，围栏里的字不许两头都不见。`ChatPane.test.tsx` **+122/−3**：删 1 条（`requires an explicit confirmation before starting chapter generation`——它断言的正是本条推翻的行为，按「决定被推翻才改其内容」搬家，`uiInvariants` 侧一条未删），加 3 条（`/generate` 全程零点击且缓冲长度严格递增；合法 draft 围栏 PUT 恰好 1 次且 URL/body 逐字、屏上无卡；历史恢复卡片回来而 PUT 为空）。**两条踩过的坑**：① 前两条必须 `useFiles.setState({ novelId: 1 })`，`novelId` 为 null 时 `applyProposal`/`reload` 直接返回、测的不是真那条路（与 `ChatPaneProposal.test.tsx:54-55` 同一做法）；② 反向变异还原时我把 Edit 锚点写进 JSX 块内，一次编辑吞掉了 `}` 与 `setRows((prev) =>`——按项目记忆那条自查后单独补回，`git diff --numstat` 认回 **+14/−13** 才算还原干净。**真机**（5173 当前源码 ＋ 8000 换好的新进程 ＋ 作品 7 选中「0001 · 苏醒」，零额度零写入）：三种节点命中各 **0**、工具栏剩 计划／写作／上传附件／默认模型／发送 五控件（`388,856 456×37`），3× 近景 `g3529b-2-toolbar-clip.png` 亲自看过；②③④那三条判据在真机未量（要一轮真模型对话），门禁 **312 passed / 26 files** ＋ `tsc` 退出 0 ＋ `npm run build` ✓ 1.71 s。

- 2026-09-11 · 批次 35.28（裁定进 **D-55**）：`ChatPane.tsx` **+19/−15**。composer 那两颗模式从此是**状态栏**：`role="radio"`、`aria-checked`、两处 `onClick` 全撤，容器的 `role="radiogroup"` 一起退场（留 `aria-label="对话模式"` 与一句 `title`），两颗 `disabled` ＋ 显式 `aria-disabled={true}`（前者让它真的点不动也不进 Tab 序，后者是判据要在 DOM 上量到的那个属性）。新增派生值 `shownMode`＝最近一答实际用的 `row.meta.mode`（`.at(-1)?.meta.mode ?? mode`），两处 `className` 只读它——本地 `mode` 不再决定屏幕上哪一侧亮，但 `setMode` 与它保留（`/plan` 与请求体还在用，不是死代码）。`ChatPane.test.tsx` **+22/−4**：35.15 那两行「开关仍显示主人拨的那一侧」的断言**按决定搬家**为「点亮的是这一答实际用的那一侧」（搬家不删），新增一条判据逐字测试——两颗的 `role` 为 `null`、`aria-disabled` 为 `"true"`、`disabled` 为真，且真点下去 `.selected` 不动。真机（5173 ＋ 8000 ＋ 作品 7 已有线程，零额度零写入）：真点击未点亮那一侧（410,876）后点亮侧 `写作`→`写作`、卡片 5→5、悬停颜色不变；把 `/chat/messages` 那一次响应最后一条 assistant 的 `mode` 在**浏览器侧**改成 `plan`（库未动）后状态栏点亮 `计划`，与最后一答那颗 `按「计划」` 相同、前面那颗仍是 `按「写作」`。

- 2026-09-11 · 批次 35.30（裁定进 **D-53**）：`ChatPane.tsx` **+27/−2**。命令表里 `/generate` 从 `args: ""` 变成 `args: "<章节序号>"`，描述改成「生成该章正文；不写序号就是当前选中章」——自动补全那一行 `<code>{name} {args}</code>` 就是这条命令的说明书，参数形状从此只有一个出处。另一半是**印出来的参数必须真的生效**：`runCommand` 从前算出 `argument` 就在 `/generate` 分支里丢掉（自 `b46cb95`），现在走模块级纯函数 `chapterByArgument(argument, chapters)` 对 `chapter_number`，命中就 `openChapterTab()` 把那一章端到前面（页签 ＋ 右栏一起换），对不上就用 `unmatchedChapter()` 给一句带示例的话（「「99」对不上任何一章：/generate 后面跟章节序号，例如 /generate 1」，示例取自 `chapters[0]`，不是写死的 3）。**否掉弹窗那条路**：主人给的两条候选里取「直接告诉他加序号」。`ChatPane.test.tsx` **+52/−0** 两条：`/generate 2` 的流必须打到 `/chapters/from-brief/10/stream` 且不再打 8、选择跟着换；无选中章节时那颗步骤的 `<p>` 必须带着可照抄的那一句。真机（5173 ＋ 作品 7，零额度零写入）：`/generate 5` 后活动页签「第 1 章 苏醒」→「第 5 章 旧识」，三句失败文案逐字录在 D-53。

- 2026-09-10 · 批次 35.27：`chatTrace.ts` **+22/−2**、`ChatPane.tsx` **+1/−1**。后端现在会把模型当正文吐出来的 `propose_toc` payload（```json 里的 `{"chapters": […]}`）编译成一张 `toc.md` 卡，可落库正文里那道 JSON 还留着——同一份文件在屏幕上出现两次，正是 D-51 拦的那件事。`stripProposalFences(text, proposals)` 多收一个参数，剥除条件是后端那两个条件的镜像：这一行**有** `toc.md` 卡（`TOC_PATH` 从 `../store/files` 引，不再自造字面量）**且**正文里没有 `@toc.md` 围栏（`TOC_FENCE_OPEN`）。块体用 `[^`]*` 匹配，JSON 里不会有反引号，所以一道块绝不会跨过自己的收尾去吃下一道；摘不摘还要看块体里有没有 `"chapters"`，不是提案形状的 json 块原样留着。没有卡时 `promoted` 为假，编译器拒掉的那段一个字都不会少。`chatTrace.test.ts` **+29**（出卡即摘／无卡不摘／已有 `@toc.md` 围栏时不摘／非 chapters 形状不摘）。

- 2026-09-10 · 批次 35.26（提交 `e9638fc`，本条为补记——那次提交只带了源文件，漏了这一目录的账）：`MarkdownText.tsx` **+49**、`MarkdownText.test.tsx` **+36**。`.chat-md` 那张形状表里没有表格这一支，主人第 70 条回答那份三列五行的方案表于是以 `|` 与 `---` 原样摊在屏幕上（「看来你现在的对话页面并不支持列表的形式」）。新增 `TABLE_SEPARATOR`（认分隔行，兼容 `|---|:--:|`）与 `cells()`（掐首尾竖线再切，逐格 `trim`），扫描循环里紧接围栏分支之后加一条表格分支：表头那一行加下一行是分隔行才成立，之后连续含竖线的行都进表体，**格内仍走 `inline()`**，所以 `**B 目录**` 这类标记在格子里照样成元素。判据逐条量在他那条逐字表格上：`thead th=3`／`tr=5`（thead 1 ＋ tbody 4）／`tbody td=12`／正文里含竖线的 `<p>` **0 个**，另加一条反例钉「可选 A | B 两种落点」这种句子里的竖线**不算**表格。`uiInvariants` 未动：那个文件管跨文件不变量，本条是单文件渲染能力，再 grep 一遍源码是重复登记。

- 2026-09-10 · 批次 35.20 / 35.21 / 35.22（裁定进 **D-51**，提交 `5254edf` ／ `eb59101`）：`chatTrace.ts` **+25**，新增纯函数 `stripProposalFences()`——落库正文里那道「三个反引号 + markdown + `@路径`」的围栏本来就是提案的载体（服务端每次读历史都从它重新派生提案），而 `splitTrace` 从前只剥 `[TOOL_CALL]`，于是 `MarkdownText` 把整份被提议的文件排成 `.chat-code`、提案卡再在下面逐行排一遍：同一屏两个代码框，点完应用卡片卸载而围栏留下（35.21）。`@路径` 是必需段，正文里引用的普通代码块不受影响；未闭合时整段不显示。`ChatPane.tsx` **+17/−7**：历史重放只挑 `item.valid` 的（35.20——被结构闸门拒过的永远写不进去，D-38 不因「恢复」破例），渲染改成 `splitTrace(stripProposalFences(row.text))`，恢复那一次调用带 `{ restore: true }`（35.22）。测试 `ChatPaneProposal.test.tsx` **+3 例**、`chatTrace.test.ts` **+5 例**。

- 2026-09-10 · 批次 31.4（裁定进 **D-50**）：`chatRows.ts` **+6/−2**——`toolLine` 的入参从内联 `Extract<ChatStreamEvent, { event: "tool" }>["data"]` 换成命名后的 `ChatToolStep`，函数体一行未动，文档串补一句「一个函数两个调用方」；这是「轨迹文案只有一个构造器」那半句的落点，刷新那份与流式那份走的是同一支函数，所以两行**逐字**相同。`ChatPane.tsx` **+7/−0**，只在 `fromHistory` 里给 `reads` 喂 `(row.steps ?? []).map(toolLine)`——`??` 那半是实测换来的：真机对主人那台旧 8000 量过，`/chat/messages` 回 **25 行**（13 user ＋ 12 assistant）、`anyHasSteps false`，必需字段写法下 `fromHistory` 在 map 里抛一次就整批不渲染（`agentRows 12→1`、`bodyHasHistory true→false`），补上 `??` 后同一台旧后端 **12 行都还在**、只掉这一列。`ChatPane.test.tsx` **+31/−0** 新例 `puts the tool trace back when the answer is read from history`，钉的四件事：`<ChatPane />` 拿一份带 2 步的历史行渲染，`lines` 必须 `toEqual(steps.map(toolLine))`（同源，不是转述）、抬头 `本轮读取 · 2 步`、`lines[0]` 含 `未成功`（`ok: false` 不许被洗白）、`lines[1]` 含 `1.4s`（1400ms → 一位小数）。`ChatPaneProposal.test.tsx` **+5/−0**，5 份历史行夹具各补 `steps: []`——`steps` 是可选的，不补也编译，补是为了让这 5 例显式声明「这一答本就没有轨迹」，免得将来读到空 `reads` 时分不清是缺字段降级还是真没有。**反向变异（D-33）**：M3 摘掉 `ChatPane.tsx` 那一行 → `ChatPane.test.tsx` 1 failed；M4 把 `ChatToolStep` 的 `ms`/`chars` 改回可选 → `uiInvariants` 1 failed **且** `tsc` TS18048 退出 2；两处各自还原（md5 与备份一致）后全绿。既有断言一条未删。

- 2026-09-10 · 批次 32.4（裁定进 **D-49**）：**组件代码一行未改**，只补断言。`FileEditorPane.test.tsx` **+78/−0** 新例 `lands the applied rows in the rendered list, and the same document in the source`，接在既有那例「shows a pending B-layer proposal in the rendered list without writing it」之后——两条合起来才是判据的后半句：确认前列表可以叠一层「待确认预览」但不许伪装成已写入（旧例管），确认后两屏得是同一份（新例管）。钉的四件事：`applyProposal` 返回 `true`、徽标摘掉、`.toc-row` 恰好 1 行且 `entry.draft` 等于落库那份、`pending` 清空，再 `setView(path, true)` 切到源码面断 `.cm-content` 含同一句章名。**反向变异（D-33）**：把 `store/files.ts` 的 `applyProposal` 里那句 `await get().reload(landed)` 摘掉 → 应用后列表 **0 行**（这条用例红），装回即绿，md5 与备份一致，故本条不是「前端本来就好所以随便写的断言」，它钉的是 `reload` 那一行仍在被读。**界面控件未动，故不加 `uiInvariants` 断言**（加了就是重复计数，56 条沿用 35.15）。真机侧的数字（浏览器时间线 5811ms 上屏／12 行／应用后源码面 467 字符与列表同一份）记在 D-49 与 WORKSTREAM-PLAN §8。

- 2026-09-10 · 批次 35.15（裁定进 D-41）：`chatRows.ts` 的 `AgentMeta` 加 `mode?: string`，`context` 分支 `mode: event.data.mode`、`done` 分支 `mode: meta.mode ?? message.mode`（与 `refs` 同一条「先到的赢」）；`ChatPane.tsx` 的 `fromHistory` 补 `mode: row.mode`（刷新后仍在），说话行在 `.chat-who` **之后**渲染 `按「计划」`／`按「写作」`（放后面是因为 `.chat-actions .chat-who` 带 `margin-left: auto`，放前面会把模型名推到行尾），chip 带 `aria-label` 给读屏，旧注释里「模式已经在开关上了」那句随之作废；`ChatPane.test.tsx` 新增 `runTurn` 与两例（两种模式各一行，钉 `按「计划」` 出现而开关仍勾「写作」）。真机取证走**计划态、不花主人网关额度**：5173 当前源码 + 8037（`i3516.db` 作品 6 副本），历史里本就有 `mode='plan'` 的行——量到 **13 条答案行 13 条带标签**（11 写作 / 2 计划），msg 57 与 msg 67 显示 按「计划」而同一屏 composer 勾着「写作」；chip 55×17px、右边界 `847` 恰等于行右边界（未裁切）、与模型名同一行；说话行 `opacity` 悬停前 `0`／悬停后 `1`（跟随 `.chat-actions` 既有规则，不为一个标签破例；要它常驻只需搬进行首那行）。判据原句在决策函数上直接量：`effective_mode("给第 1 章写一份简报","write") == "plan"`。截图 `3515-top.png`／`3515-plan.png`／`3515-hover.png` 亲自看过。

- 2026-09-10 · 批次 35.4（裁定进 D-46）：`FileEditorPane.tsx` 对「写入落地」的反应从 `void loadChapterRecords()` 换成 `void reloadChapterList()`。量的：应用一张合法简报提案卡后 `PUT` 已 200、`GET /chapters` 已是 1 条，而左树仍报「还没有章节」、非要手动刷新——旧调用取的是所选章的生成记录与评审，树一个字段都不读。复测（8035 + `i354.db`，0 章作品）：不刷新页面即 `chapters 0→1`、树行 `9→12`、「还没有章节」消失，与刷新后的快照逐项相同，四个标签逐个 HTTP 200。`FileEditorPane.test.tsx` 原有那例「re-reads the chapter records once a proposal has landed」**未删**，改写成这条链的完整版（清单两次 GET + 记录一次 GET + StrictMode 双跑不刷新）。

- 2026-09-10 · 批次 35.3（裁定进 D-45）：`ProposalCard.tsx` 把折叠那颗钮从 `.proposal-diff` 列表**末尾**搬成独立 `fold` 节点、渲染进 `.proposal-head`（与文件名、`AI 提案 · +N −M · 第 X 行` 同一行）。原因不是状态而是几何：真机 Edge+CDP 真鼠标点「展开全部 50 行改动」后卡片 1403px、`收起` 落在 `top=1429`，而 `.chat-messages` 可视底边 `756`，控件在视口外 **673px**，主人看到的就是「展开后没法再收起」；头部在它下方长多少行都不动，复测 `moreTop` 403→403（位移 **0px**）、展开前后 `moreVisible` 均 `true`、DOM 行数 8→50→8。双向逻辑（`setShowAll((value) => !value)` + `aria-expanded`，`c978ce3` 起）一寸未改，两个分支继续共用同一份 `changeRows`。同批 `ProposalCard.test.tsx` 新增 `pins the fold control above the rows it folds (35.3)`（先红后绿），原有两条双向断言一条未删。

- 2026-09-09 · 历史加载遇到已等同当前文件的最新提案时，同时清除同路径旧待处理卡，避免导入成功后旧红字重新出现。
- 2026-09-10 · 修复提案确认过滤：所有 proposal 进入待处理状态，只有主人点击应用才写入。
- 2026-09-10 · 对话代码块启用软换行；CodeMirror 编辑器启用 lineWrapping。
- 2026-09-10 · 目录长文本单元格改为可增长换行；渲染目录覆盖编辑区（含缩略栏），避免源码底色泄露。
- 2026-09-10 · 无效提案也展示完整 diff，便于主人审查并重新生成；应用按钮仍严格禁用。
- 2026-09-10 · 对历史提案中的“内容/起止章”可纠正别名开放应用；其他结构错误继续禁用。

- 2026-09-09 · TocListView 在 B 层提案待确认期间渲染临时目录并显示状态标识；不修改文件 buffer。

- 2026-09-09 · ChatPane rows and thinking details now use a 180ms ease-out entrance animation with reduced-motion override.

- 2026-09-09 · 精简组件地图，标明三处仍未接真实数据的面板；未改源码。
- 2026-09-08 · ChatPane 展示每步成本；cmDoc 改为消费服务端 grammar；测试 fixture 不再抄标签。
- 2026-09-07 · 对话 reasoning、工具轨迹、人物文档渲染与恢复动作完成并纳入 UI 不变量。
- 2026-09-05 · 建立提案、标签栏、三栏、焦点和控件图形语言的不可回退断言。
 - 2026-09-09：在 ChatPane 工具栏加入“确认并生成”按钮，复用现有 `/generate` 命令与 `generateDraft` 流程；不新增 Agent 写工具。
- 2026-09-15：U-01：ChatPane 消费 `draft` SSE，将章节预览写入既有 draft buffer；作者在流中手改时停止自动落盘并保留提案卡。
- 2026-09-16：新增 `ContextWorkflowPanel`：React Flow 仅作画布，保存的 policy/graph 严格镜像后端 workflow schema。
- 2026-09-16：补齐 `author_instructions` 来源：默认画布与模块策略新增「作者指令 / 文风约束」，保持后端 kind 原值并默认启用；`uiInvariants` 固定来源节点、模块和 graph source 的对应关系。
- 2026-10-22 · V-19：`ContextWorkflowPanel.tsx` 连线落下即拒绝环路、输出节点作起点、开始节点作终点、条件出口缺失，理由气泡挂在目标节点下 4px（`role="alert"`、4 秒消失、不进撤销栈）；补齐 Delete、框选多选、Ctrl+C/V、Ctrl+Z / Ctrl+Shift+Z，键位守卫在焦点落到 `<body>` 时仍生效。`ContextWorkflowPanel.test.tsx` 6 项覆盖删除后撤销、复制粘贴与重做；真机 Edge CDP 20/20 项、保存 revision 7/8 与基线图结构 API 回读一致，截图 `v19-cycle-reason.png`、`v19-multi-select.png`、`v19-after-delete.png`。
- 2026-10-23 · V-19 阻塞：`ContextWorkflowPanel.tsx` 草稿同步改为只对资源树显式选择（store 的 `workflowSelectionNonce`）起反应，不再因 `draft.id` 变化回选旧流程；`ContextWorkflowPanel.test.tsx` 新增第 7 项「新建 review 草稿等待后仍保持并保存为 review」。真机新建 review 草稿等待 1.2s 与保存后标题/类型不变，API 回读 id 8 `purpose=review`、`is_default=false`。
- 2026-10-23 · 审查收口：`TreePane.tsx` 流程徽标显示 `当前 · vN` / `当前 · 未发布`，新增 `TreePane.test.tsx` 覆盖设定搜索浮层打开、结果点击、空态与 Escape；`ContextWorkflowPanel.tsx` 标题带 `vN`/未发布并在发布后重读版本；`EditorPane.tsx` 调用记录新增 `终审打回` 行（时间 + 引用原因），`EditorPane.test.tsx` 补回读用例。
