# backend/app/routers/ 更改账（最新在上）

- 2026-09-10 · 批次 35.9（D-42）：`config.py` 的 `/api/config/llm` 多带一个 `agent` 对象（`AgentBudgetOut` 读回当前值与出厂值，`AgentBudgetIn` 写入，越界在落库前 422），保存仍走同一条 PUT、同一次 `session.commit()`。`chat.py` 两条路由不再用出厂常量，改由 `resolve_config(session)` 取本轮预算；流式那条在生成器启动**之前**取，因为请求 session 到那时已经关了。
- 2026-09-09 · 精简说明并明确路由只做 HTTP 边界；未改源码。
- 2026-09-07 · 增加章节重排/删插、范围恢复与对话历史端点。
- 2026-09-06 · 增加作品和人物删除、配置、导出与快照恢复端点。
- 2026-09-03 · /planning 写路由退役为 410，文件投影成为规划写入口。
