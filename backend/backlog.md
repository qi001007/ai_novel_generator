# backend/ 更改账（最新在上）

一条一行：日期 · 批次批注 · 一句话 + 提交哈希。细节在提交信息里，别往这里抄。

- 2026-09-07 · 29.4 · `renumber.py` 加 `densify()` 与 `renumber_plan()`；
  `chapters.py` 加两条路由（报告在前、动手在后）。`c4fe78d`
- 2026-09-07 · 29.3 · `llm.stream_messages` 开 `channels` 第二条通道；
  `agent.py` 发 reasoning 事件；`chat.stream_turn` 转成 SSE。`def07de`
- 2026-09-07 · 29.2 · `chat.py` 加 `list_conversations()` 与 `GET /chat/conversations`。`b3658b1`
- 2026-09-07 · 29.1 · `storage.py`：快照记下范围（book/chapter/room/renumber）、
  排序键改成时间戳那一段、新增 `snapshot_chapters` / `restore_chapter` /
  `_merge_toc_row`，并修掉一处与 26.7 同形状的快照句柄泄漏。`448bc67`
- 2026-09-06 · 28.6 / 28.7 / 28.8 · 章号=位置、恢复弹回原位、conversation_id。
  逐条见 `git log --oneline -- backend/`。

- 2026-09-07 · 贯彻「每层一份 description.md」：新建 `app/` `app/routers/` `app/services/` `tests/` `scripts/` `alembic/` `alembic/versions/` 七份说明（各 5-13 行）与对应 `backlog.md`；本目录 `description.md` 24 → 17 行（细节下沉，不再重复子目录内容）。新增机械检查 `tests/test_folder_docs.py`（4 条，实扫 11 个目录）。**本目录代码未改**，只加了一份测试。
- 2026-09-07 · 接 living-docs-governance：`tests/test_folder_docs.py` 再加两条防漂移断言（DECISIONS §0 索引与正文编号必须一一对应；四角色接线不许被拆），做过变异验证（抽掉一行索引立刻红）。本目录代码仍未改，测试数 260 → 262。
- 2026-09-07 · 文档去重那一刀落在这里：`test_folder_docs.py` 拆成 7 条（新增 `test_doc_roles_have_one_owner` 反向钉「哪份文档装什么」这张表只许有一份，主人是 `docs/ARCHITECTURE.md` §0.6）。做过变异验证：往 `DECISIONS §6` 再抄一份立刻红。测试数 260 → 263。本目录代码未改。
- 2026-09-07 · 死代码清理（vulture 逐条取证后）：删 `app/services/planning.py` 的 `PlanningDomainError`（全仓零引用）；删 `app/services/llm.py` 的 `resolve_settings`——它是第十九批「供应商成列表」重构留下的**兼容壳**，生产早已改走 `RoutedLLMClient(resolve_routing(...))`，只剩测试引用。那 5 条断言**搬到真实调用面**（`resolve_routing(session).settings_for(...)` / `.global_settings()`），一条没删、值一字未改。`vulture==2.16` 记进 `pyproject` dev 依赖，档位纪律写进本目录 `description.md`（日常只跑 >=90 档；132 条低置信候选里只有 1 条真死）。验证：263 passed，与删改前同数。
- 2026-09-07 · 补一刀小的：`routers/settings.py` 那个 410 退役桩的参数加 `# noqa` 并写明为什么留着，于是 vulture `>=90` 档从此**恒零命中**——以后这一档再冒出来就一定是真死代码，不用再看噪声。
- 2026-09-07 · 架构走查候选 1（draft 流水线两个主人）：`routers/chapters.py` 的流式端点原本自己实现了一整条生成流水线（挡已有正文、组上下文、落 `GenerationRun`、机械校验），与非流式的 `services/chapters.py:42-117` 各写一遍。现在四个事实各归一个主人：系统提示→`prompts.py`、温度→`llm.py:DRAFT_TEMPERATURE`、409 文案与离线模型名→`services/chapters.py`、落库+校验→`persist_draft()`；router 只剩 SSE 事件编排（含「事件流里不许抛，必须 yield error + partial」这条保留原语义的要点）。**更正**：走查报的「流式 0.8 / 非流式 0.6」不成立——`complete_messages` 的回退本来就是 `0.8 if task_type == draft`，两条路同值；真问题是同一策略两处各写字面量，今天碰巧一样、明天改一处就分叉。防回归：新增 `tests/test_draft_policy_single_owner.py` 四条源码文本不变量。测试 263 → 267。
- 2026-09-07 · 架构走查候选 3：新增 `services/errors.py`（域错误→HTTP 的唯一形状）；`StorageError` 与 `DocumentError` 支持 `code`，两处需要调用方分支的错误拿到机器码——`export_dir_not_set`、`write_conflict`；六个 router 映射点收成一个 `HTTPException(**errors.http_kwargs(cause))`。`test_storage.py` 的 detail 断言加强成「码 + 文」。267 passed。
- 2026-09-07 · 候选 2（SSE 六个主人）后端侧：新增 `app/sse.py` 拥有帧编码与响应头；`routers/chat.py` 与 `routers/chapters.py` 的两个逐字相同的编码器、两份响应头收成一份。**实测到一处真漂移**：对话流带头里 `Connection: keep-alive`，正文生成流没带——现在两条同形（这是本次唯一的行为变化，故意）。新增 `tests/test_sse_single_owner.py` 三条源码不变量。267 passed（流式两条路径的测试本来就在真解析 SSE 字节，等于端到端验过）。

- 2026-09-08 · §六 第 1 步的前半（流式原生 tool_calls）：`llm.py:stream_messages` 新增 `tool_calls_out`，
  按 `index` 把 `delta.tool_calls` 分片拼回完整调用（这台网关**确实**回标准通道，旧前提只在非流式成立，更正记进 D-28）；
  `agent.py` 流式分支交出 `raw = {"tool_calls": native}`，`parse_native_calls` 不再是死码；`LLMClient` 契约与
  `RoutedLLMClient` 同步，三个测试替身补形参。新增 `tests/test_stream_tool_calls.py` 4 条 + `test_agent_loop.py` 通路测试 1 条，
  273 → 278 passed；变异三次分别 3 红 / 1 红 / 2 红。真机跑在**副本库**（`.scratch/probe-agent.db`，验后已删）上，
  两次真调用：`tool read_file ok:true`、答出「地点。」。**另记一条不属于本轮的抖动**：子进程里连跑全量偶发 1 条红、
  每次不是同一条（见过 `test_a_refusal_names_the_chapter_that_is_missing` 与 `test_create_and_list_generation_run`），
  单跑与直接连跑 4 次全绿 —— 没查，只登记。

- 2026-09-08 · §六 第 1 步后半：Pydantic AI 循环、`GatewayChatModel`、`NOVEL_AGENT_ENGINE` 开关与
  只读框架工具落地；新增 12 条双引擎契约/离线剧本测试，278 → 290 passed。隔离库真机
  `read_file ok`，SSE `reasoning 153 / delta 89 / tool 1`，usage `input=1512 / output=282`。
