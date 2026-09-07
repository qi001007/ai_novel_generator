# backend/ —— 后端

**这里放什么**：FastAPI 应用 + SQLite 持久层。`app/main.py` 挂路由，`app/routers/`
是 HTTP 边界（只做校验与转发），真正的语义在 `app/services/`。数据库是单文件
`novel_generator.db`，迁移在 `alembic/`，测试在 `tests/`。

**四条不能破的**（全文与理由在 `docs/DECISIONS.md`）：
- D-01 四层规划只有一条写通路：`PUT /api/novels/{id}/files/{path}`。
  `/planning/*` 只读，写请求一律 410；新建章与简报也走这一条。
- D-02 DB 是唯一真源，`chapters/NNNN/*.md` 是投影，不是文件树。
- D-04 上下文只有一个构造器：`services/context.py` 的 `collect_items()`。
  要改注入内容就改对应 collector，不改调用方、不改提示词模板。
- D-13 / D-29 / D-32 章号是位置、章名是主人给的：删章后移、插章后移、
  重排只搬号不动名字。凡写章号的地方都要跟着搬，清单在 `services/renumber.py`。

**Agent 红线**：`services/agent_tools.py` 的注册表里没有写工具。改规划只有
「提案 → 主人在界面上点应用」这一条路。谈 Agent 能力前先 grep 取证，
不许把「测试全绿」说成「功能已实现」。

**怎么跑**：`.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
**怎么测**：`.venv\Scripts\python.exe -m pytest -q`（期望条数只写在 `docs/HANDOFF.md`）

**改完这里的东西**：在 `backend/backlog.md` 追加一行。

