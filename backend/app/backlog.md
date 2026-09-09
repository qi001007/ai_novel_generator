# backend/app/ 更改账（最新在上）

- 2026-09-10 · 批次 31.4（裁定进 **D-50**）：`models.py` **+7/−0**，`ChatMessage` 在 `context_refs` 与 `token_input` 之间多一列 `steps`（JSON、`nullable=False`、`default_factory=list`）——那条答复跑过的每一步跟着它一起落库，刷新后「本轮读取 · N 步」读的是它，不再是流式期间的内存。表数仍是 16，配套迁移在 `alembic/versions/c4e7a1b8d206`。
- 2026-09-09 · 校正说明为 5 个运行时文件与 16 张表；未改源码。
- 2026-09-07 · sse.py 成为流式响应帧与响应头的单一实现。
