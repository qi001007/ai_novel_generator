# backend/ —— FastAPI + SQLite 后端

向下读取：app/ 是运行时；app/routers/ 是 HTTP 边界；app/services/ 是业务与 AI 编排；
alembic/ 管 schema；tests/ 管回归；scripts/ 管手动冒烟。每层都有自己的说明。

全局边界：SQLite 是唯一真源；规划与文本设定只经文件投影写口；collect_items() 是唯一资料池；
章号搬移只经 services/renumber.py；Agent 注册表没有任意写工具。

依赖与启动命令见 pyproject.toml 和 docs/HANDOFF.md。改本层后在 backlog.md 记一条。
