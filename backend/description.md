# backend/ —— 后端（FastAPI + SQLite，单文件库 `novel_generator.db`）

**一层管一件事，往下看**：`app/` 骨架（`models.py` 定义全部表）→ `app/routers/` HTTP 边界 →
`app/services/` 业务与模型编排 → `alembic/` 改库结构 → `tests/` 回归 → `scripts/` 手动冒烟。
**每个子目录都有自己的 description.md，要细节往下读，别在父文件里找。**

**四条全局红线**（理由在 `docs/DECISIONS.md`，落点在各子目录）：
- D-01 四层规划只有一条写通路 `PUT /api/novels/{id}/files/{path}`；`/planning/*` 只读、写回 410。
- D-02 DB 是唯一真源，`chapters/NNNN/*.md` 是投影，不是文件树。
- D-04 上下文只有一个构造器：`services/context.py` 的 `collect_items()`。
- D-29 / D-32 章号是位置、章名是主人给的；搬号清单在 `services/renumber.py`。

**Agent 红线**：`services/agent_tools.py` 的注册表里没有写工具。谈 Agent 能力前先 grep 取证，
不许把「测试全绿」说成「功能已实现」。
**怎么跑** `.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`；
**怎么测** `.venv\Scripts\python.exe -m pytest -q`（期望条数只写在 `docs/HANDOFF.md`）。
**改完这里的东西**：在 `backend/backlog.md` 追加一行。
