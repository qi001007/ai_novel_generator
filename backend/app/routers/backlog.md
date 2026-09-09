# backend/app/routers/ 更改账（最新在上）

- 2026-09-10 · 批次 35.5（D-47）：`chat.py` 的历史端点与卡片构造函数 `ChatMessageOut.of(..., person_path=...)` 各多带一个读手（`character_path_reader(session, novel_id)`），让「已在档的人名 → 改指他的档案路径」这一条在**流式**与**刷新**两条路上同一个判法——刷新走的是这条路由，不是 `services/chat.py` 的生成器。**登记不改**：`ChatProposalOut` 没有 `note` 字段，所以改道时那句「人物「罗九」已在档，提案改指 …」只在流式里出现过，刷新后丢失；主人看的是卡有没有回来，本轮不动它。

- 2026-09-10 · 批次 35.9（D-42）：`config.py` 的 `/api/config/llm` 多带一个 `agent` 对象（`AgentBudgetOut` 读回当前值与出厂值，`AgentBudgetIn` 写入，越界在落库前 422），保存仍走同一条 PUT、同一次 `session.commit()`。`chat.py` 两条路由不再用出厂常量，改由 `resolve_config(session)` 取本轮预算；流式那条在生成器启动**之前**取，因为请求 session 到那时已经关了。
- 2026-09-09 · 精简说明并明确路由只做 HTTP 边界；未改源码。
- 2026-09-07 · 增加章节重排/删插、范围恢复与对话历史端点。
- 2026-09-06 · 增加作品和人物删除、配置、导出与快照恢复端点。
- 2026-09-03 · /planning 写路由退役为 410，文件投影成为规划写入口。
