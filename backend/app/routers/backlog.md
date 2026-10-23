# backend/app/routers/ 更改账（最新在上）

- 2026-10-23 · G-01/V-19：新增 `workflow_runs.py`：`GET /api/novels/{novel_id}/chapters/{chapter_id}/workflow-runs` 返回该章真实运行摘要（用途、模型节点、token、job/review/accept 关联）；`GET /api/workflow-runs/{run_id}` 补节点快照、context 排除原因、review 与 accept Operation；章名统一从当前 `TocEntry` 取，避免 `Chapter.title` 为空时详情页显示空标题。
- 2026-10-23 · 配置状态按路由：`GET /api/config/llm` 与 `GET /api/llm/status` 的 `configured` 改读 `routing.is_configured`，不再只看默认供应商；后者新增 Session 依赖以解析路由。
- 2026-10-22 · M-01：`maps.py` 新增 `POST /maps/{id}/expand` 与 `POST /maps/{id}/cells/{x}/{y}/regenerate`：校验父版本、费用与 1024 画布，遮罩编辑后整幅 draft 落库；未配置扩图模型 409、供应商失败 502；版本输出补 `width/height/cols/rows/cell/parent_revision/operation`。
- 2026-10-22 · M-02：新增 `maps.py`：列表/创建/提示词/详情/重命名/删除、生图版本、确认与图片读取；`confirm_billing` 缺失在调用前 422，未配置生图模型 409，下载失败不落版本；删除作品同事务清地图记录并按目录删图。
- 2026-10-21 · B-02：增加章节候选生成/列表接口；文件 PUT 可携带 generation_job_id，经服务层校验原稿版本与候选来源后接受，不新增正文写端点。

- 2026-10-19：废止会绕过确认和 Operation 的旧 Workflow DELETE 直写端点；返回 410 并指向 `workflow.delete` 的预览/执行闭环。

- 2026-10-19：Workflow 路由缩回 HTTP 适配器；新建、保存、默认切换和发布兼容端点均调用统一命令，不再自行提交这些业务写入。
- 2026-10-19：`config.py` 新增非生成的 `GET /api/config/llm/models`，复用连接测试的 OpenAI 兼容 `/models` 请求并返回去重排序的模型 ID；Agent 配置错误统一使用“内部步骤”语义。

- 2026-10-19：新增 `/api/images/generations` 单张生图边界；连接测试与模型客户端统一忽略不支持的 `ALL_PROXY=socks5h`，真实百炼 `/models` 返回 HTTP 200。
- 2026-10-18：新增 `agent_runs.py`，让启动页也能创建持久化平台 Agent Run，并恢复高风险命令的批准或拒绝。

- 2026-10-18 · Workflow 增加现代节点 Schema、编译校验、不可变发布、运行详情与人工审批恢复接口；保留旧 source/model 图兼容读取。

- 2026-10-18 · 新增 `/api/context/preview`，模型调用前可检查选中/排除资料、理由和估算 Token。

- 2026-09-16 · U-05：新增单条 review suggestion PATCH；只能修改 replacement/comment/status，按作品、章节、review 和数组索引四重归属检查，不提供正文写口。

- 2026-09-10 · 批次 31.4（D-50）：`chat.py` **+4/−1**，只在读历史这一侧补一列。`_MESSAGE_FIELDS` 里加 `"steps"`（紧跟 `"context_refs"`），`ChatMessageOut` 加 `steps: list[dict[str, Any]] = Field(default_factory=list)`——`ChatPane.fromHistory` 读的就是这条路由，落库了不发出去等于没落。**不改构造**：那一列的形状由 `services/chat.py:800` 的 `step_record` 独家出产，本文件只透传，不在此处再拼一份文案。

- 2026-09-10 · 批次 35.5（D-47）：`chat.py` 的历史端点与卡片构造函数 `ChatMessageOut.of(..., person_path=...)` 各多带一个读手（`character_path_reader(session, novel_id)`），让「已在档的人名 → 改指他的档案路径」这一条在**流式**与**刷新**两条路上同一个判法——刷新走的是这条路由，不是 `services/chat.py` 的生成器。**登记不改**：`ChatProposalOut` 没有 `note` 字段，所以改道时那句「人物「罗九」已在档，提案改指 …」只在流式里出现过，刷新后丢失；主人看的是卡有没有回来，本轮不动它。

- 2026-09-10 · 批次 35.9（D-42）：`config.py` 的 `/api/config/llm` 多带一个 `agent` 对象（`AgentBudgetOut` 读回当前值与出厂值，`AgentBudgetIn` 写入，越界在落库前 422），保存仍走同一条 PUT、同一次 `session.commit()`。`chat.py` 两条路由不再用出厂常量，改由 `resolve_config(session)` 取本轮预算；流式那条在生成器启动**之前**取，因为请求 session 到那时已经关了。
- 2026-09-09 · 精简说明并明确路由只做 HTTP 边界；未改源码。
- 2026-09-07 · 增加章节重排/删插、范围恢复与对话历史端点。
- 2026-09-06 · 增加作品和人物删除、配置、导出与快照恢复端点。
- 2026-09-03 · /planning 写路由退役为 410，文件投影成为规划写入口。
- 2026-09-15 · 新增 `workflows.py`：工作流 CRUD、作品/全局列表、默认切换，以及 policy/graph 的输入与边约束校验。
- 2026-10-21 · S-01/S-02（责任基线 c01f812）：连接/模型目录支持未保存表单与新供应商探测，保留空密钥语义并使用配置超时；异常目录不崩溃或误报成功，连接变化清除旧缓存，草稿不覆盖已存目录。
- 2026-10-23 · C-03：`workflows.py` 的 `WorkflowOut` 新增 `published_version`，列表按批量查询填充当前发布版本（无发布为 null），不再迫使前端用成功运行反证已发布。
