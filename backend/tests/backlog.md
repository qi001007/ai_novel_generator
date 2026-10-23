# backend/tests/ 更改账（最新在上）

- 2026-10-23 · G-01/V-19：新增 `test_chapter_workflow_runs.py` 2 条：列表含 generation/review 与 job/review/accept 关联；详情 5 节点、模型 token 合计等于总计、excluded 含「路人甲」原因、accept actor=human、章名取 TOC「雪夜」。全量业务 504 passed。
- 2026-10-23 · 配置状态：`test_llm_providers.py` 新增「已命名任务路由到无密钥供应商时 configured=false，补上该供应商自己的密钥后翻 true」；定向 42 passed，全量 501 passed。
- 2026-10-23 · V-19 阻塞：`test_command_catalog.py` 新增「新建流程不替换已发布系统默认」回归（绑定仍指向旧流程、旧 revision 不变、新记录 `is_default=false`）；定向 11 passed，全量业务 500 passed。
- 2026-10-22 · M-01：新增 `test_map_canvas.py` 11 条（偏移、遮罩、贴回、尺寸拒绝）、`test_masked_edit.py` 8 条（异步提交一次、轮询、失败脱敏、未配置）；`test_maps.py` 加 8 条扩图/单格重绘/下载重试/非对齐画布；后端业务全量 499 passed。
- 2026-10-22 · M-02：新增 `test_maps.py` 10 条：假供应商生成/本机回读/版本递增与确认取代/草稿不替换/删除清目录/缺模型与缺费用闸门/路径穿越与丢失文件/本地 HTTP 回归 `NO_PROXY="[::1]"` 下载。
- 2026-10-21 · B-01/B-02：新增默认 Workflow 输入/完整自检/无效 JSON 回归，以及候选未发布拒绝、生成不写稿、接受幂等、跨作品/路径/内容/版本保护；后端业务 456 passed，MCP 缺依赖仍阻止完整收集。

- 2026-10-20：新增作品默认双 Workflow、唯一用途绑定及旧库 review/model 回填迁移测试；全量后端门禁更新为 444 passed。

- 2026-10-19：新增 Workflow 删除行为门禁：未确认拒绝、批准删除、默认项接替、撤销恢复，以及已有发布历史时禁止删除。

- 2026-10-19：统一命令回归覆盖 Workflow 新建、保存、重命名、默认切换、发布、幂等、旧 revision 冲突及逐步撤销；迁移测试校验 revision 列。
- 2026-10-19：平台 MCP 浏览器契约补站内跳转、真实右键与 CDP 文本输入测试；Workflow context 节点新增真实构造上下文的运行回归；全量后端 `437 passed`。

- 2026-10-19：新增 Workflow 真实模型节点回归，验证节点调用统一供应商路由、传递任务/模型/温度并把模型输出与 Token 汇总写入运行详情。

- 2026-10-19：平台 MCP 契约更新为 15 项工具，覆盖同会话逐动作交互＋测量审计、元素比例点击、真实滚轮动作和精确 CSS 视口，以及只由调用方 CSS selectors 组成的测量表达式；定向 9 项通过。

- 2026-10-19：平台 MCP 的拖拽白名单补回程终点与越界拒绝测试，用于真实验证“不松鼠标越界关闭后反拉恢复”。

- 2026-10-19：补 `/models` 非生成目录测试，并把 Agent 默认 20 / 上限 64、停止文案和运行时配置断言统一到“内部步骤”；全量后端 431 项通过。

- 2026-10-19：平台 MCP 门禁测试新增标准输入隔离与超时诊断守卫，防止测试进程占住 MCP stdio 会话。

- 2026-10-19：新增工作台中栏 Agent 审计回归：流式请求创建 AgentRun，高风险 ToolCall 与真实 preview 随历史恢复，批准后只产生一次 Operation。
- 2026-10-19：平台 MCP 契约覆盖 14 项工具，并验证页面交互仅接受 click/input/scroll、拒绝任意 evaluate 动作。
- 2026-10-18：新增平台 MCP 验收：12 项控制面、低 Token 工作区摘要、危险写入确认、路径隔离与固定门禁白名单。
- 2026-10-18：新增平台 Agent Run 验收：空书架创建作品、运行读回、高风险暂停、批准与拒绝零写入。

- 2026-10-18 · 新增纯净重建命令目录回归：公共 Schema、单事务回滚、幂等、乐观并发、高风险审批与撤销。

- 2026-09-15 · 补开放 Markdown 小节回归：蓝图、简报、人物统一 PUT/刷新/数据库投影，typed Agent proposal，迁移双向 upgrade/downgrade。

- 2026-09-14 · 批次 36.1／36.2：SearXNG 原始 URL 回归与主人选择模式不被关键词覆写的后端回归均通过。

- 2026-09-11 · 批次 35.34（D-59）：新增 `test_chat_command.py`（**7 例**，全套 **405 passed**，35.34 前 398）。① `test_a_command_row_is_persisted_with_role_command`：`/generate 1` 跑完，`GET /chat/messages` 里有一行 `role=="command"` 且 `command_state` 含 `command:"/generate"`。② `test_running_status_is_never_persisted`：流式中途读库，command 行**不存在**（`running` 只在内存）。③ `test_settled_content_overwrites_the_same_run_id`：同一 `run_id` 结算后 `content` 是结算文案、`command_state.status` 是 `"done"` 或 `"error"`，行数不增长（upsert 不破例）。④ `test_command_rows_are_excluded_from_model_context`：构造一段含 `command` 行的历史，`_history_messages` 输出里 `role=="command"` 计数 **0**。⑤ `test_a_second_run_for_the_same_chapter_upserts`：连续两次 `/generate 1`，command 行只有最新那一份。⑥ `test_downgrade_drops_the_column`：`downgrade` 后 `command_state` 列不存在，再 `upgrade` 回来。⑦ `test_command_state_default_is_empty_dict`：旧行（迁移前插入）`command_state` 读回 `{}`。

- 2026-09-11 · 批次 30.7 第一条：`test_writing_context.py` **+34/−0**，三条新用例接在 `test_cast_character_is_core_and_bystander_is_fill` 之后，既有用例一条未删，全套 **400 passed**（35.29a 结案时 397）。按 TDD 先写用例再写实现——落笔时 `WritingContext` 还没有这个字段，三条都取不到值。① `test_brief_named_character_without_a_card_is_reported`：简报点名「林渊」（有卡）＋「白衣人」（无卡）→ `ctx.missing_characters == ["白衣人"]`，且 `manifest()` 里同键同值——后半句钉的是「**进了落库的那一份**」，只钉内存里的字段等于没钉，主人看到的是历史 run 的清单。② `test_fully_matched_cast_adds_nothing_to_the_manifest`：全命中 → 空表。这条是防「为了看得见而什么都报」的**反向**用例，它必须对 ① 那种变异不敏感（下面实测正是如此），否则它就在替实现背书。③ `test_terminal_report_names_the_unmatched_cast`：先量全命中那份报告里「未命中人物」**不出现**（不许多出一行空话），再把简报改成有未命中，重算后 `未命中人物：白衣人` 必须在。两半都在同一条用例里，是因为「多打一行」和「少打一行」是同一个病的两面。 **反向变异（D-33）实测**：把 `build_writing_context` 里那行差集临时换成 `missing_characters = []` → ①红在 `test_writing_context.py:181`、③红在 `:204`（报告里那句随之消失），②**照绿**——它量的是「不多报」，本来就不该被「少报」的变异打死，这是设计而非漏网；还原后本文件 **21 passed**，`git diff --numstat` 回到 **+19/−5** 与探针串 `grep -c` 归零，两处一起证明变异没在树里留渣。**没有**为这条改提示词：注入内容归 collector 一家（D-04），模型侧看到的仍是它本来就看得到的那些卡。


- 2026-09-11 · 批次 35.29a（裁定进 **D-54**）：`test_chat_agent.py` **+26/−0**，一条新用例 `test_write_mode_prompt_names_the_draft_file_as_the_landing_point`，既有断言一条未删，全套 **397 passed**（35.27 结案时 396）。它钉的是「一件事在提示词里有三处说，三处必须同说一件事」：前三串（`@chapters/NNNN/draft.md`／「一整章的正文不是一段回答」／「围栏外不要把这一章再复述一遍」）出自 `chat.WRITE_BODY` 第 1 条，后两串分别出自 `chat.FILE_EDIT_RULES` 与 `agent.TOOL_RULES` 那两份「只有没有动作工具的对象才手写代码块」的封闭清单——模型读的是拼在一起的一整段，漏任何一处就是自相矛盾。**反向变异（D-33）用机械证明代替改源码**：另跑一支脚本按块查这五串，逐串 `count == 1` 且分属三个块（`WRITE_BODY`／`FILE_EDIT_RULES`／`TOOL_RULES`），所以删掉任一处文案，对应那句必红；实现前该用例确曾红在 `test_chat_agent.py:250`。既有那句「不加解释、不加标题、不加大纲」（`:231`）逐字保留未搬家。**没有**为这条加前端断言：`chatTrace.stripProposalFences` 剥的是路径无关的 ` ```lang @路径 ` 形状，`toc.md`／`arcs.md`／`settings/foreshadow.md` 三例已钉（`chatTrace.test.ts:78-104`），再钉一遍 `draft.md` 是重复登记。真机那半（气泡 28 字／卡 `valid:true`／点应用后 50 字）记在 `docs/UI-BACKLOG.md` 35.29 与本目录 `services/backlog.md`。


- 2026-09-10 · 批次 35.27：`test_documents.py` **+54/−0**，三条用例接在 35.2 那条范围标题用例之后，全套 **396 passed**（31.4 结案时 393）。输入用的是主人作品 7 第 72 条回答的逐字形状，不是我自己造的样例。① `test_a_json_chapters_block_becomes_a_toc_card`：```json 里的 `{"chapters": […]}` 出**一张** `toc.md` 卡、`valid is True`，并且卡的 `text` 真能被现有那条 `PUT /files/toc.md` 收下（写回后再读库确认第 2 章在档）——判据的后半句「不需要主人再手抄一遍」量的就是这一步。② `test_a_json_block_that_is_not_a_toc_payload_stays_plain_code`：`{"persons": […]}` → `cards == []`，认的是形状不是「凡是 json 都是提案」。③ `test_a_json_chapters_block_the_compiler_refuses_still_produces_no_card`：少一个 `title` → `cards == []`，编译器说拒就不许卡片这一侧改口造一张坏卡（D-38 那道闸门不因多一条入口而放宽）。**未加**真机断言：当前 8000 上跑的是改代码之前起的进程，`--reload` 没吃掉这次改动，浏览器那一屏量了也不算数（登记在 UI-BACKLOG 35.27 的「未验的一半」）。

- 2026-09-10 · 批次 31.4（裁定进 **D-50**）：`test_agent_chat.py` **+61/−0**，两条新用例、既有断言一条未删，全套 **393 passed**（32.4 结案时 391）。① `test_the_trace_comes_back_with_the_answer_after_a_reload`（`:307`）钉的是**判据本身**：流式跑完一轮，清空浏览器不算——直接 `GET /chat/messages` 读回，断那一行 `steps` 里第 1 步的 `name`／`arguments`／`ok`／`ms`／`chars` 与当轮 SSE `tool` 事件逐字段相同，即「刷新后那一份不是改写过的转述」。② `test_the_non_streaming_route_stores_the_same_trace`（`:346`）补非流式那条路，防止只在流式生成器里落库、`/chat` 一次性接口留一列空的。**反向变异（D-33）M1**：把 `services/chat.py` 两处 `persist_reply(..., steps=...)` 摘掉 → 这两条**同时红**（2 failed），还原后全绿。**引用推偏一处已按真值改回**：这 61 行插在 `:307` 之前，把 35.6 记的「人物 `test_agent_chat.py:307`」推成 `:368`（B 层 `:225`、时序 `:266` 在插入点之上，未动），改的是 DECISIONS D-48、UI-BACKLOG 35.6 横幅、WORKSTREAM-PLAN 35.6 行三处引用。

- 2026-09-10 · 批次 32.4（裁定进 **D-49**）：`test_agent_chat.py` **+41/−0**，一条新用例 `test_the_b_layer_card_arrives_while_the_stream_is_still_open`（既有断言一条未删），全套 **391 passed**（35.18 结案时 390）。这条量的不是「有没有卡」而是**事件顺序**——那是本批唯一能证时序的断言：`use_fake` + `SteppedClient` 三轮（`propose_toc` 的工具块 → 「目录排了两章，」→ 「后面再补。」），断 `order.index("tool") < order.index("proposal") < 最后一个 delta`，再断 `len(cards) == 1`（同一条提案不许中途一张、收尾又一张）、`path == "toc.md"` 且 `valid is True`，最后断言此刻 `GET /chapters` 仍是 `[]`——**实时不等于越权**，卡上屏与真源写入之间那道闸门（D-37）仍由主人那一下点击把着。**反向变异三次（D-33）**，各自红一次：关掉 `chat.py` 里中途那次发射 → `proposal` 落回所有 `delta` 之后（`['context','tool','delta','proposal','done','end']`）；去掉收尾的 `surfaced` 去重 → 两张卡；三处还原后全绿。**引用推偏一处已按真值改回**：本用例插在 `:266` 之前，把 35.6 记的「人物 `test_agent_chat.py:266`」推成 `:307`（B 层 `:225` 在插入点之上，未动），改的是 DECISIONS D-48、UI-BACKLOG 35.6 横幅、WORKSTREAM-PLAN 35.6 行三处引用，不是任何结论。

- 2026-09-10 · 批次 35.18（裁定进 D-41 新增的「层名只有一种写法」）：`test_chat_agent.py` **+23/−0**，既有断言一条未删，全套 **390 passed**（35.16 结案时 383）。两处加法：① `INTENT_CASES` 三行 `重新生成C层` / `重新生成 C 层` / `重新生成c层` 都判 `plan`——表驱动每个形状在两个开关方向各跑一遍，所以是 **6 条**用例；改前先红（`重新生成C层` 与 `重新生成c层` × `write` 开关 **2 failed**，带空格那条一直绿），改后 28 passed。判据要求「三种写法在两个开关方向上都判 plan，逐条钉在测试里」，这里就是那一条。② 新增端到端 `test_the_owners_c_layer_phrasing_reaches_the_server_as_plan`（`:602`），走真 ASGI 应用＋假网关发主人那句原话、开关拨 `write`，断提示词体含 `## 本轮模式：计划` 且 `禁止输出章节正文` 在，再读回 `/chat/messages` 断**落库两行 `mode` 真的都是 plan**——落库那份正是 35.15 那颗答案行标签读的字段，纯函数返回值证明不了服务端存了什么。**反向变异（D-33）**：把 `services/chat.py` 单独暂存回改前（tagged stash `qoder-3518-mutation-check`，跑完 `pop`、条目已 drop），表驱动 2 例与这条端到端**同时红**（3 failed），还原后全绿。**同批改回的引用**：这 23 行把 35.6 记在本文件里的四处 `test_chat_agent.py:行号` 推偏，已按真值改过（697→720、648→671、608→631、744→767），`test_agent_chat.py` 那两条未受影响。

- 2026-09-10 · 批次 35.16（D-39 新增「配对判定先于 bullet 缺失」）：`test_documents.py` **+51/−0**，一条新用例 `test_a_short_arc_book_says_deletion_before_it_says_missing_fields`（既有断言一条未删），全套 **383 passed**（35.6 结案时 382）。判据要求「两种文案各有一条断言钉住先后」，所以这条用例一次造三份料、按先后各问一遍 `validate_structure`：① 三条弧的档上只列两条且号对得上 → 首句必须是 `不能删除条目或改动 arc 主键`；② 三条列全、只省 bullet → 仍然必须是 `「弧 1 卷一」 … 缺少 起始章、结束章、冲突、收束、状态`（这条是 D-43 继承的边界，写在这里防被下一次「顺手统一文案」改掉）；③ 主人真机那条的实际形状——号与档上完全不搭（书里 1..3，围栏写 7、8）且省了 bullet → 拿到的是同一道闸门的兄弟句 `提案不能自己点号`，且断言 `缺少 起始章` **不出现**。末段把同一份围栏交给 `extract_proposals` 走抽提案那条路，断言卡 `valid is False` 且 `card["error"]` 首句就是那句结构判定——主人在界面上读的是卡上那行字，不是函数返回值。真机侧的对照取证记在 `docs/WORKSTREAM-PLAN.md` §8（8039＝HEAD 工作树 vs 8037＝当前码，同一份截到 msg 67 的副本库，六张 arcs 卡五张逐字未变）。

- 2026-09-10 · 批次 35.6（D-48）：三个文件，全套 **382 passed**（35.5 结案时 377，净 +5 条用例）。① `test_chat_agent.py` **+88/−0** 两条 e2e 补上判据第 1 句缺的两类：`test_a_streamed_blueprint_fence_applies_to_the_a_layer`（A 层围栏 → 卡 `path=blueprint.md` 且 `valid` → 点应用**之前** `/planning/blueprints` 仍是 `[]` → PUT `changed` 五字段全中 → 行读回 + 投影读回）、`test_a_streamed_prose_fence_lands_on_the_chapter_it_names`（`chapters/0001/draft.md` → `changed==["content"]`、`content` 与散文逐字相同、`word_count==len(散文)`）。② `test_agent_chat.py` **+140/−0** 三条：`test_a_refused_action_returns_a_diagnostic_and_one_more_ask_lands_a_card` 量的是**回路**而不是校验——一条 `number="11-30"` 的 B 层请求被拒后，`(name, ok)` 必须是 `[(propose_toc, False), (propose_arcs, True)]`（这条在改 `_compile` 之前是红的：拒绝曾记 `ok=True`），诊断「动作未通过校验…update_arcs…」要真的回到模型那一侧，且整轮只花 3 次请求，最后那张 `arcs.md` 卡 PUT 200、弧 1 条；另两条把 B 层与人物补齐成**从 `tool` 块出发**的端到端（`test_a_propose_toc_ask_lands_the_b_layer_on_the_chapter_rows`：`chapters` 由 `[]` 变 `[1,2]`；`test_a_propose_character_ask_lands_a_real_archive`：确认前 `/characters` 为 `[]`，应用后写入回报的是数字档案路径而非 `new.md`，`/characters` 读到 `沈砚 · 守钥人末代`）。新增模块级 `tool_block()` 助手与 `import json`。③ `test_agent_tools.py` **+15/−6** 是断言搬家不是删断言：`proposal_text`（继续断 `ok is True`）旁边拆出 `refusal_text`（断 `ok is False, result.content`），四处拒绝用例（范围条目、缺字段、自己挑路径、删条目）迁过去——那 6 行删除全是这几条调用自身被改写的那一行，成功用例（`FIVE_ACTIONS` 逐条、追加三条弧）一条未动；旧助手上那句讲拒绝的注释随语义进 `refusal_text` 的 docstring。

- 2026-09-10 · 批次 35.5（D-47）：`test_character_files.py` 新增 2 例（该文件本轮 `git diff --numstat` **+65/−0**，既有断言一条未删），全套 **377 passed**（35.2 结案时 375）。① `test_the_invented_characters_alias_resolves_to_the_create_template`：判据首句的形状——模型自己拼出来的三个写法 `settings/characters.md` / `characters.md` / `settings/characters` 逐个 GET 都 **200** 且 `path` 归一到 `settings/characters/new.md`，再经这条别名 PUT 一次建出苏黎、回报的是**数字档案路径**（真源在 D-02：号由书分配）。反向闸一并钉住：`settings/characters/9999.md` 仍 404。② `test_an_applied_character_create_fence_is_not_offered_again`：主人踩到的第二次点击——同一份建卡围栏在人物已落库后重抽，卡的 `path` 必须改指他的档案且 `text` 与档上文件一致（前端据此 `baseText === text` 收卡）；把「目标」改掉再抽仍是合法卡、PUT 200、`goals` 真的更新，别名折叠没把编辑类写入一起挡掉。

- 2026-10-19：新增百炼兼容单张生图请求/响应、安全错误脱敏、image 环境变量、连接测试代理隔离与 MCP 常驻启动回归；定向 29 项通过。
- 2026-09-10 · 批次 35.2（D-44）：`test_documents.py` 新增 2 例（`git diff --numstat` 本轮该文件 +78/−0，既有断言一条未删），全套 **375 passed**（35.1 结案时 373）。① `test_two_arcs_appended_in_one_proposal_do_not_land_on_the_same_key`：主人那条 B 层围栏自己改道出来的 C 层卡实测死在这一步——`弧 N` 是行的全局自增 id，而 `_resolve_ids` 按「本书最大 id + 1」猜号，本书 id 落后于全局时猜出的号会撞上本次提案刚插入的那一行。先往另一本书塞一条弧把全局计数抬高，再一份「重写两条 + `弧 ?` 追加两条」的围栏，断言 200、`## 弧 ` 为 4、101 与 141 两个起始章都在。② `test_a_range_heading_in_the_b_layer_becomes_an_appliable_c_layer card`：判据原句的形状——`## 第 44-60 章 弧 3：门钥之谜` 与 `## 第 61-120 章 弧 9-13：永恒的相对` 经 `extract_proposals` 从 B 层围栏抽走，断言两张卡都 `valid`、toc 侧不再有区间标题而 42/43 两条记录一寸未动、arcs 侧标题里的 `弧 3：` 与跨号 `弧 9-13：` 前缀整段去掉、起止章取自标题区间，两张卡各 PUT 一次都 200。**第二轮**是主人真机踩到的那一步：以落库后的 `toc.md`/`arcs.md` 作当前档把同一份围栏再抽一次，arcs 那张卡的 `text` 必须与档上文件一字不差（前端据此收卡）、第二次 PUT 仍 200、`## 弧 ` 计数不增长——旧代码在这里是 9 条变 16 条。夹具与 35.1 那 4 例保持原样。

- 2026-09-10 · 批次 35.1（D-43）：`test_documents.py` 新增 4 例与一个共用夹具 `_two_arc_novel`——不用 `seed_novel`，因为它那条弧的 `冲突`/`收束` 是空串，「省略不等于清空」就没有可断言的值；改为自己建一本书、两条弧各带不同的六个字段。① `test_a_regenerated_arc_book_inherits_the_bullets_the_model_omitted`：判据原句的形状（整本重写、每条只留「目标」），断言 200 且六个字段回到文件原值。② `test_an_appended_arc_no_longer_costs_the_existing_ones_their_inheritance`：主人真机那张红卡的形状（重写两条只改目标 + `弧 ?` 追加一条），断言三条记录、已有两条主键与起止章不动、只有可选字段是系统给的默认值。③ `test_dropping_an_arc_is_still_refused_after_the_inheritance_fix`：反向闸——少一条仍是 422，档上两条一条没少。④ `test_an_applied_arc_fence_does_not_come_back_red_on_reload`：判据末条「刷新后红字 0」，同一份围栏落库后经 `extract_proposals` 重读，卡的 `text` 必须与文件一字不差（前端据此收卡）。既有断言一条未删。全套 373 passed。

- 2026-09-10 · 批次 35.9（D-42）：新增 7 例。`test_llm_config` 四例盯配置面——出厂即 `6 / 60000` 且带得出厂值、主人改 9/120000 后 GET 读得回、只带一项的 PUT 不许覆盖另一项、越界（`max_steps=0`、`max_tokens=500`）422 且库里什么都没存，另加一例库里被手改成一不是数字的行时回落默认值、二是天文数字时压到护栏上界。`test_agent_loop` 两例盯放大依据——把主人实测那一轮（6 个请求合计 32955）逐笔摊开，在新默认值下必须跑完并交出卡，在旧的 30000 下必须在第 6 轮被掐；`test_the_measured_plan_turn_fits_under_the_default_ceiling` 里那句合计断言就是 60000 的算式，改默认值必须连它一起改。`test_agent_chat` 一例把「可配置」量进真实请求：主人存下 2 轮/1000 后，一轮假网关对话报的是「超过上限 1000（第 2 轮）」而不是出厂数字。既有的两条预算停止测试（含 `test_agent_pydantic` 的引擎参数化那两条）只在原断言后追加「当前上限 N token / M 轮」与入口那句，一条未删。
- 2026-09-10 · 批次 35.14：`test_agent_tools` 新增 `test_the_arcs_contract_says_the_list_covers_the_whole_book`（`ACTIONS["update_arcs"].rules` 必须含「全量 / 按文件里的顺序 / 新弧追加在末尾」三要素）与 `test_a_moved_range_diagnosis_names_the_way_out`（照抄主人实测那条负载：`arcs` 1 条 + `existing` 2 条，拒绝文案必须出现「把已有各弧一并列进 `arcs`」）。`test_documents` 的既有 append 测试里补一句「一并列全」断言，原断言一条未删。

- 2026-09-10 · 批次 35.10（D-41）：`test_chat_agent` 新增 `INTENT_CASES` 11 句（简报 / 目录 / 剧情弧 / 人物卡 / 蓝图 / 文件路径名各一，正文三类，两边都不点的两句）配 `@pytest.mark.parametrize` 双层，开关拨 `write` 与 `plan` 两个方向都必须判到同一个对象，共 22 例；另加两条端到端——写作开关下「给第 1 章写一份简报」的系统提示含 `## 本轮模式：计划` 与 `propose_chapter_brief`，计划开关下「把第 1 章的正文写出来」拿到写作提示且不含「禁止输出章节正文」。

- 2026-09-10 · 批次 35.13：`test_documents` 新增 `test_the_first_chapter_added_to_an_empty_toc_also_creates_the_chapter`——空 toc 用 `actor=ai` 应用「## 第 1 章 开门」，断言 `changed` 含 `1.created`、`/chapters` 由 `[]` 变 `[1]`、文件表出现 `chapters/0001/draft.md`。它补上既有那条「已有条目再追加」测试没覆盖的另一半分支，先红后绿。

- 2026-09-10 · 批次 35.8（D-40）：`test_agent_tools` 补三条——`grammar_text` 与 `grammar_for_kind` 逐标签同源（标签一律从表反查，测试里不硬编码）、`read_file` 给每份文件带上它 kind 的表（按 `FileDoc.kind` 反查）、没有表的正文文档原样返回。`test_chat_agent` 的「提示词教文件提案格式」不删断言、跟着新决定搬家：示例不再落在 `toc.md`、「只改值」改成 D-39 的「只允许追加」、五个 `propose_` 工具名必须在场；新增一条盯住提示词里不许再出现「都可以」这类等价表述（含 legacy 引擎的 `TOOL_RULES`）。

- 2026-09-10 · 批次 35.7（D-39）：原「AI 不能增删记录」改为「可追加、不可删除与改号」，补 `弧 ?` 追加与自选号被拒；新增预览卡与写入闸门同判定的 8 例对照，改号还原单列一测；新增 `propose_arcs` 按当前 `arcs.md` 判主键；改写 `test_agent_chat` 里长期红色的「报给模型的工具清单」断言（补上 5 个 `propose_*`，非删断言）。

- 2026-09-09 · 35.12：新增 `test_canonicalization_keeps_the_unassigned_arc_heading`，覆盖以往所有弧测试都只用数字主键、从未走过的 `弧 ?` 路径（标题保留 2/2、回解析主键 `[1, None]`）。

- 2026-09-09 · 增加双剧情弧首次导入及导入后历史提案等同当前 Markdown 的回归断言。
- 2026-09-09 · 增加空 B/C 首次应用、C 层别名流式提案和搜索实体接口回归。
- 2026-09-09 · 更新写作上下文回归：锁定 B/C ±20、上一章简报与完整正文、其他章节正文排除及世界观相关性。
- 2026-09-09 · 更新测试目录说明；文档不再保存固定测试总数。
- 2026-09-08 · 增加双引擎契约、网关工具调用分片、预算/用量与工具失败测试。
- 2026-09-15 · U-01：补对话 draft 围栏分片预览回归，断言增量快照先于 proposal/done 且数据库正文仍未提前写入。
- 2026-09-07 · 增加目录治理、章号重排、恢复范围、对话线程与 reasoning 测试。
- 2026-09-03 · 增加文件写口、投影语法和统一上下文回归。
- 2026-09-15 · 新增 `test_workflows.py`：CRUD/默认作用域、非法字段与非法边、缺失作品和重名校验。
- 2026-09-16 · 写作上下文增加默认工作流实质注入、正文尾部截取和无默认工作流回归测试。
- 2026-09-16：补世界观与伏笔自定义小节的记录内 round-trip 测试；相关 66 条文档/上下文测试通过。
- 2026-09-16 · U-05：`test_reviews.py` 先钉 suggestion 结构被旧 schema 拒绝，再覆盖唯一正文 quote 的上下文锚点及作者更新 replacement/status 的 PATCH；定向 7 条通过。
- 2026-10-21 · S-01/S-02：增加未保存/新增供应商、Authorization 与超时、空密钥、错误目录、无效 URL 和缓存归属回归，使用隔离数据库与模拟网关，不读取主人密钥。
- 2026-10-23 · 审查收口：`test_chapter_workflow_runs.py` 新增正文标题取 TOC 的回归（`正文 · 第 1 章 雪夜`），`test_workflows.py` 新增列表/详情 `published_version` 断言；后端全量 505 passed（仍排除缺 `fastmcp` 的平台 MCP 测试）。
- 2026-10-23 · V-21：新增 `test_arc_window.py` 4 条（滑动/未来标记/数量封顶/API 生成回读）；另有 agent 对话轨迹测试在全量下偶发一次空轨迹，单跑与全量重跑均绿，待 V-22 排查。
