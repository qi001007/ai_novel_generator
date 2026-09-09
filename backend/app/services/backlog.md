# backend/app/services/ 更改账（最新在上）

- 2026-09-10 · 批次 31.4（裁定进 **D-50**）：`chat.py` **+25/−13**。① 新增 `step_record(step) -> dict`——一轮里跑过的每一步落成普通 dict，**这是这个形状在本服务里唯一被造出来的地方**；`stream_turn` 的 `elif name == "tool"` 分支从内联那份 12 行 dict 改成 `yield ("tool", step_record(payload))`（那 12 行就是本条的删除主体）。② `persist_reply(...)` 多收一个 `steps`，`ChatMessage(...)` 里 `steps=list(steps or [])`；流式与非流式两个落库点都传 `steps=[step_record(step) for step in outcome.steps]`。于是「流式期间那行」与「刷新后那行」是同一份记录的两次阅读，不是两份文案——真机（假网关 8123 ＋ 探针后端 8042 ＋ `i324.db`）量到刷新前 2 行、刷新后 2 行、逐字相同 `true`。

- 2026-09-10 · 批次 32.4（裁定进 **D-49**）：`chat.py` **+30/−6**，一个文件、一处新发射点。`stream_turn` 从前只在整条流收尾时抽一次围栏（输入是 `merge_step_proposals(...)` 的最终文本），于是 `propose_toc` 那一步早就编译出了合法目录，主人却要等模型把收尾那句客套话打完字才看到卡。① 新增 `_turn_proposals(factory, message_id, text)`：把「拿 novel_id → 取真源读手 → 过 `extract_proposals`」收成一处，中途那一步与收尾那一次**共用它**，所以过的仍是同一道 D-38 合法性闸门、走的仍是同一条 D-40 提案通道，不是第二条。② `elif name == "tool"` 分支里，一步 `ok` 且工具名以 `PROPOSE_TOOL_PREFIX` 开头就当场 `yield ("proposal", ...)`，并把 `(path, text)` 记进新增的 `surfaced` 集合；收尾那次改为只发 `surfaced` 里没见过的（模型自己写进正文的围栏仍走这条路）。**否掉的两种写法**：在工具回调里另造一份卡（校验规则会复制成两份，D-38 不再是唯一闸门）；收尾照旧全发一遍（同一条提案在界面上变两张卡）。**代价写明**：中途发的卡可能赶上一轮后来撞 D-42 预算被 `AgentBudgetError` 终止，而那条分支不 `persist_reply`——卡不是写（D-37），主人不按就什么都没有；「出错就把屏上的卡一并撤掉」是 `ChatPane` 的一句清理，与本条时序无关，未做。真机（假网关 8123 + 探针后端 8041 + `i324.db`）：`proposal` 事件 **7484ms → 5704ms**，与那步成功同一毫秒。

- 2026-09-10 · 批次 35.18（裁定进 D-41 新增的「层名只有一种写法」）：`chat.py` 两处，服务同一句话——主人的 `重新生成C层` 从前两把提示词表都不点中，`effective_mode()` 落回开关那一侧，D-41 自己写着「含 A/B/C/D 层」的那半没兑现。① `PLANNING_CUES` 里 `"a 层"…"d 层"` 的空格拿掉，层名从此只有一种写法；② `lowered` 从 `text.lower()` 改成 `re.sub(r"\s+(?=层)|(?<=层)\s+", "", text.lower())`，只抹挨着「层」的那个空格，且在两把表**之前**抹一次，`PROSE_CUES` 与 `PLANNING_CUES` 读同一份归一化文本（归一化口径一处主人）。**否掉的写法**：把全部空白抹掉——实测 `to cache` 会焊成 `tocache` 而含得下 `"toc"`，一句无关英文能悄悄改判模式；只抹「层」两侧后 `I want to cache this` 在 `write` 开关下仍判 `write`。

- 2026-09-10 · 批次 35.16（口径进 D-39 新增的「配对判定先于 bullet 缺失」）：两个文件，只为把一道判定挪到另一道前面。`markdown_doc.py`（**+21/−0**）新增 `record_keys(kind, text)`——**只读标题**取一份记录列表的主键，正文缺 bullet 也能问出「这条围栏列了哪几条」，`parse` 那条路一个字没动。`documents.py`（**+42/−21**，那 21 行删除整块就是原先内联在 `validate_structure` 里的配对块）把这道问题抽成模块级 `_pairing(kind, current_text, offered)`，`validate_structure` 的 parse 成功分支与 `except DocumentError` 分支**共用同一个 `_pairing`**：少列了档上记录的围栏同时也省了 bullet，从前它先撞 parse 那句「缺少 起始章、结束章、冲突、收束、状态」就 return，更准的结构判定永远读不到（主人作品 6 实测）。`_resolve_ids` 在全仓仍只有 `_pairing` 这一个调用点，D-39 的「判定只有一处／文案只有一处」一寸未动；`_pairing` 对「问不出问题」的四种情形（无 offered、无当前档、无主键的层、标题根本不是记录、当前档读不动）一律返回 `""`，把话交还给能精确回答的那一处。

- 2026-09-10 · 批次 35.6（裁定进 D-48）：`agent_tools.py._compile` 一行语义改动，从 `return text if ok else f"{DIAG_PREFIX}{text}"` 改成拒绝时 `raise ToolError(f"{DIAG_PREFIX}{text}")`。以前拒绝的诊断是**返回值**，`ToolRegistry` 就把这一步记成 `ok=True`，前端 `chatRows.ts:81` 只在 `ok` 为假时才写「未成功」——主人屏幕上是一整列绿步骤加一张没出现的卡，正是判据点名的那种「成功假象」。抛 `ToolError` 后 `agent.py:117` 转成 `ToolResult(ok=False, content=同一句诊断)`：**回给模型的诊断一字未改**，改的是这一步的记账，`_proposal_tools` 那张表与 `_gate` 都没动。「一次有界自修复」因此不需要新代码：模型下一次问就是**下一轮请求**，照旧受 D-42 主人存下的轮/token 上限管；**没有**在 `_compile` 里就地重试，那会造出第二条控制流、绕开预算与停止条件。
- 2026-09-10 · 批次 35.5（裁定进 D-47）：两处，服务同一件事——**一个路径只折叠一次**。① `documents.py.resolve_path` 首行改成 `normalized = canonical_path(path)[0]`：`canonical_path` 一直是唯一那张别名表，但从前只被 `chat.py` 抽提案的预览调用，工具读与 `PUT` 直接进 `resolve_path`，于是「`settings/characters.md`」在预览里认得、在读写口 404。折叠接进来后各入口同源；真缺的档案仍 404 且文案更准（`characters/9999.md` → 「人物 9999 不存在」）。② 同文件新增 `character_path_reader(session, novel_id)` 返回 `姓名 -> 该人物档案路径`（一本书查一次、带缓存），`chat.py.extract_proposals` 多接一个 `person_path`：一张写着**已在档**人名的「新建人物」围栏经 `existing_character_path` 改指他的档案路径，改道后走 D-43 那条折叠——文本与文件一致就收卡，不再递一张点下去必 409 的绿卡。「同名即同人」的真源仍是 `_write_character` 那个 409，这里只是问同一件事，别处没有第二份名字查询。

- 2026-09-10 · 批次 35.2（裁定进 D-44）：`documents.py` 四处，都服务于一件事——从 B 层改道出来的弧「认档不认块数」。① `_write_arcs` 与 `_write_book`：`弧 ?` / 主键为空的记录从前也去 `by_id` 查一遍，查不到才当新建，于是「`?`」这一条能撞上别的行；改成 `row = None if raw.get("arc") is None else by_id.get(arc_id)`，`?` 永不回查已有行。② `arc_proposal_from_toc_ranges`：上一轮 `rows = _existing_arcs(current) + moved` 无条件把改道出来的记录接到档后面，主人重读同一条 B 层围栏时那两条弧已经在书上，于是 9 条弧变 16 条（这就是 35.2 的红卡第二次 PUT 数字）。改成先按 `(起始章, 结束章)` 建索引，命中就是**编辑**那条弧、没命中才追加；且只有 `title`/`objective` 两个围栏自带的字段能覆盖，空值一律不许把档上的字清掉（D-43 的「省略不等于清空」在改道这条路上同样成立）。③ `_align_arc_history`：删掉 `len(numbered) + len(fresh) == len(existing)` 那步块数算式——「整本重写 + 追加若干条」的形状下这个等式一成立就把 `?` 也算进配额，绑定会在档上乱落。改为先把 `?` 块按确切起止章绑一遍（`bound_fresh`），剩下的编号记录再谈位置，`one_for_one` 在循环外一次算定；被绑住的 `?` 块在重建时把标题头改写回它落到的那条主键（`?` 一路读到 `_resolve_ids` 仍被当成新建，会再落一条）。④ `_ARC_TITLE_PREFIX` 吞掉 `弧 11-30：` 这类跨号前缀，改道出来的标题不再带着章号区间当名字。真机 A/B（同一份围栏、同一份库副本、只换代码）：预修那台 PUT `422 …（arc 7）`、弧数仍是 2；修好那台点击应用 200、`## 弧 ` 由 2 变 9、标题干净（「永恒的相对」）、`toc.md` 章号集合 `[1..10]` 一寸未动、**刷新后那张围栏一张卡都不剩**。结构校验一寸未让：少一条仍然 422。

- 2026-09-10 · 批次 35.1（裁定进 D-43）：`documents.py._align_arc_history` 两处。① 原先「围栏块数≠档上弧数」就整段 `return text` 放弃补齐，而 D-39 之后「整本重写 + 追加一条」是合法形状——新那条一进来，连已有各条也一起报「缺少 起始章、结束章、冲突、收束、状态」，卡是红的、应用按钮 disabled。改成：`弧 ?` 是系统待分配的主键，不参与计数，只按编号记录与档上记录一对一比对，省略的 bullet 无条件回到它落到的那条记录的原值。② 判据末条「刷新后红字 0」逼出的第二半：这张卡落库后书比围栏多一条，重读又回到整段放弃的老路、红字随刷新回来；新增 `replay` 分支允许 `弧 ?` 那块按**起止章完全相同**绑到档上那条（绑不上就是真追加，走原路径），整份围栏还原成文件本身，`chat.legacy_proposal_matches` 认出「这就是档上内容」，前端 `baseText === text` 把卡收起。`renumber` 的序列上界由 `len(existing)` 改 `len(numbered)`——replay 形状下两者不等，旧上界会让主键还原停摆。结构校验一寸未让。

- 2026-09-10 · 批次 35.9（裁定进 D-42）：`agent.py` 的 `DEFAULT_MAX_TOKENS` 由 `30_000` 改 `60_000`（`DEFAULT_MAX_STEPS` 仍为 `6`），值按作品 6 副本实测的一轮给：一句「新增一条剧情弧」6 个请求合计 32955 token、带真实历史第 5 个请求 35545，而每次请求都把整段上下文重新计费。新增 `resolve_config(session)` 一个读取点（读 `AppConfig` 的 `agent.max_steps` / `agent.max_tokens`，非数字回落默认值）、`MAX_STEPS_LIMITS (1,20)` / `MAX_TOKENS_LIMITS (1000,1000000)` 两道护栏、`budget_hint(max_steps, max_tokens)` 一句收尾文案（报当前上限并指向「设置 → 模型接入 → 对话 Agent 预算」）。legacy 的两处预算停止与 `agent_pydantic._budget_error` 都改拼这同一句，文案不再有三份。

- 2026-09-10 · 批次 35.14（口径进 D-39）：`proposal_actions` 的 `update_arcs.rules` 开头改成「`arcs` 是**全量**：已有各弧按文件里的顺序写进来，新弧追加在末尾」并点出「只把新弧放进 `arcs`」这个错法；`_arcs` 的起止章拒绝补上唯一出路「把已有各弧一并列进 `arcs`」。`documents._resolve_ids` 的少列条目拒绝补「要新增请把已有条目一并列全」。判定仍然只有 `_resolve_ids` 一处，这次只动文案，没加第二处判定。

- 2026-09-10 · 批次 35.10（D-41）：`chat.py` 新增 `PROSE_CUES` / `PLANNING_CUES` 一张词表与 `effective_mode(text, requested)`——成稿词优先判 `write`，规划对象词判 `plan`，两边都不点才照拨的开关。`prepare_turn` 在文本校验之后判一次，模式体、`temperature_for`、`log_injection` 的 note、落库的 `mode` 全读这个值，两个引擎共用同一条装配。修的是「主人要 D 层简报、Agent 吐正文」：`WRITE_BODY` 第一条就叫模型直接输出可用文字，而 `mode` 默认 `write`。

- 2026-09-10 · 批次 35.13（D-39 落全）：`_write_toc` 建 `TocEntry` 的**全量分支**（空目录或 `actor=human`）补上同一次 `_ensure_chapter`，与上面的 `actor=ai` 追加分支共用。D-39「B 层新增即建章节本体」原先只在追加分支成立，而作品 6 的首次规划恰好走空文件分支，所以主人说「创建第一章」后树仍是 0 章。仍然只有那一条 PUT 写入口（D-01）。

- 2026-09-10 · 批次 35.8（D-40）：`markdown_doc.grammar_text(kind)` 新增，与 `grammar_for_kind` 同读 `_GRAMMAR` 出给模型看的写法表；`agent_tools.read` 把这张表附在文件正文之后，没有表的文档（正文）原样返回。`chat.FILE_EDIT_RULES` 删去「用工具还是直接输出上面的代码块都可以」，A/B/C/D/新建人物只指向各自 `propose_` 工具，手写通道只留伏笔·世界观·改已有人物，过时的「条目增删都会被挡下」按 D-39 改写。`agent.TOOL_RULES` 第 6 条不再叫模型手写提案块——默认引擎那句才是模型一次都没调用工具的直接原因。

- 2026-09-10 · 批次 35.7（D-39）：`_require_same_ids` 由 `_resolve_ids` 取代，预览、`propose_*` 闸门与三条 writer 共用同一主键配对裁定；`? → 分配主键` 在 arcs/设定库真实落地，B 层新章号同时建 `Chapter`；`agent_tools` 经 `current_text_reader` 把当前文件交给闸门，`proposal_actions._gate` 因此能拒掉预览必拒的围栏。人类路径不变（仍可增删改号）。

- 2026-09-09 · 35.12：`canonicalize_proposal` 的弧标题清洗改为只删「既无数字也非 `?`」的标题，放过 `_ARC_ANCHOR` 与编译器都认可的 `弧 ?`（主键待分配）。空编号 `## 弧` 别名的老行为不变。

- 2026-09-09 · 修复双剧情弧规范化记录间缺换行；历史 B/C 提案与当前投影除系统主键外严格等价时返回当前文本，避免导入成功后刷新返红。
- 2026-09-09 · 修复确认后的空 B/C 投影初始化；C 层提案规范化收为共享入口；修正 Wikidata 实体搜索接口。
- 2026-09-10 · 提案解析兼容 toc 的“内容”别名及 arcs 的“起止章”范围写法，再交给严格结构校验；不改变主键与 AI 写入边界。
- 2026-09-10 · 继续兼容 arcs 的“核心事件”与空编号“## 弧”别名；其余结构错误仍拒绝写入。
- 2026-09-10 · 修复复合错误提示匹配，`多出 核心事件 + ## 弧` 不再错误禁用应用按钮。
- 2026-09-10 · 兼容 arcs 的“弧内悬念”别名并归入规范“冲突”字段。
- 2026-09-10 · arcs AI 提案对任意未知语义字段转为续行保留，不再逐个增加别名；主键与记录结构仍严格校验。
- 2026-09-10 · markdown 解析层为 arcs 未知语义字段增加兜底续行，历史提案不再依赖入口预处理。

- 2026-09-09 · D-36：写作上下文将 B/C 限制为目标章前后 20 章，仅上一章注入完整正文与上一章简报；其他章节正文排除，世界观按简报相关性分级。
- 2026-09-09 · Pydantic 工具桥复用 legacy 的本轮调用去重键；重复读取不再重复执行或消耗工具资源，并补回归测试。
- 2026-09-09 · 更新服务地图与大文件精准拆分规则；未改源码。
- 2026-09-08 · 新增 agent_model.py、agent_pydantic.py 与框架工具桥；预算和工具成本交由统一契约。
- 2026-09-07 · renumber.py 集中处理章号引用；storage.py 支持范围快照与整章恢复。
- 2026-09-03 · context.py 的 collect_items() 收为唯一资料池；documents/markdown_doc 收为唯一投影写手。
# 2026-09-09 · web_search 增强（对应 UI-BACKLOG 32.1）

- 聚合中文维基百科与 Wikidata；返回标题、摘要、URL，按标题去重；瞬时上游错误重试一次；全来源无结果时明确提示，全部不可用时返回工具失败；继续保持无写工具与 transport 注入测试。
