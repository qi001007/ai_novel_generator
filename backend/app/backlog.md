# backend/app/ 更改账（最新在上）

- 2026-10-22 · M-02：`models.py` 新增 `MapProject` 与 `MapTile`（版本存为 `(x=0,y=0,revision)`，tile 带图片相对路径、提示词、provider 与元数据）；`main.py` 挂载 `maps.router`。
- 2026-10-19：`ContextWorkflow` 增加 revision；重命名与默认切换开始使用统一命令的乐观锁与审计记录。
- 2026-10-18 · 建立纯净重建核心：统一命令目录、事件流、工作区聚合接口及带修订/审批/撤销/运行审计的领域模型；默认数据库切换为 `novel_generator_v2.db`，旧库不自动读取。

- 2026-09-15 · 开放 Markdown 小节：蓝图、章节简报、人物模型持久化 `custom_sections`，保持 Markdown 投影与 API 响应可刷新恢复。

- 2026-09-11 · 批次 35.34（裁定进 **D-59**）：`models.py` **+6/−0**——`ChatMessage` 新增 `command_state: dict = Field(sa_column=Column(JSON, nullable=False, server_default=text("'{}'")))`，与既有 `steps` 列同一写法（`server_default` 兜住旧行）。`routers/chat.py` **+31/−0**——新增 `recordCommand()`（upsert：同一 `run_id` 只留一行，`running` 状态不落库，结算时覆写 `content` 与 `command_state`）；`_history_messages` 过滤条件 `role in {"user", "assistant"}` 本就把 `command` 排除在模型上下文之外，未改。`services/chat.py` **+12/−3**——`/generate` 分支在起棒前 `recordCommand(run_id, status="running")`、结算时 `recordCommand(run_id, status=..., content=结算文案)`；`running` 只在内存里，`persist_reply` 那条路不碰 command 行。

- 2026-09-10 · 批次 31.4（裁定进 **D-50**）：`models.py` **+7/−0**，`ChatMessage` 在 `context_refs` 与 `token_input` 之间多一列 `steps`（JSON、`nullable=False`、`default_factory=list`）——那条答复跑过的每一步跟着它一起落库，刷新后「本轮读取 · N 步」读的是它，不再是流式期间的内存。表数仍是 16，配套迁移在 `alembic/versions/c4e7a1b8d206`。
- 2026-09-09 · 校正说明为 5 个运行时文件与 16 张表；未改源码。
- 2026-09-07 · sse.py 成为流式响应帧与响应头的单一实现。
- 2026-09-15 · 新增 `ContextWorkflow` 模型，保存全局或作品专属的上下文策略与画布图 JSON；作品删除清理其专属工作流。
