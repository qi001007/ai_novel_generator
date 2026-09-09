# backend/tests/ 更改账（最新在上）

- 2026-09-10 · 批次 35.2（D-44）：`test_documents.py` 新增 2 例（`git diff --numstat` 本轮该文件 +78/−0，既有断言一条未删），全套 **375 passed**（35.1 结案时 373）。① `test_two_arcs_appended_in_one_proposal_do_not_land_on_the_same_key`：主人那条 B 层围栏自己改道出来的 C 层卡实测死在这一步——`弧 N` 是行的全局自增 id，而 `_resolve_ids` 按「本书最大 id + 1」猜号，本书 id 落后于全局时猜出的号会撞上本次提案刚插入的那一行。先往另一本书塞一条弧把全局计数抬高，再一份「重写两条 + `弧 ?` 追加两条」的围栏，断言 200、`## 弧 ` 为 4、101 与 141 两个起始章都在。② `test_a_range_heading_in_the_b_layer_becomes_an_appliable_c_layer_card`：判据原句的形状——`## 第 44-60 章 弧 3：门钥之谜` 与 `## 第 61-120 章 弧 9-13：永恒的相对` 经 `extract_proposals` 从 B 层围栏抽走，断言两张卡都 `valid`、toc 侧不再有区间标题而 42/43 两条记录一寸未动、arcs 侧标题里的 `弧 3：` 与跨号 `弧 9-13：` 前缀整段去掉、起止章取自标题区间，两张卡各 PUT 一次都 200。**第二轮**是主人真机踩到的那一步：以落库后的 `toc.md`/`arcs.md` 作当前档把同一份围栏再抽一次，arcs 那张卡的 `text` 必须与档上文件一字不差（前端据此 `baseText === text` 收卡）、第二次 PUT 仍 200、`## 弧 ` 计数不增长——旧代码在这里是 9 条变 16 条。夹具与 35.1 那 4 例保持原样。

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
- 2026-09-07 · 增加目录治理、章号重排、恢复范围、对话线程与 reasoning 测试。
- 2026-09-03 · 增加文件写口、投影语法和统一上下文回归。
