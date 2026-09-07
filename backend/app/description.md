# backend/app/ —— 骨架（只有四个文件，业务一律不在这里）

- `main.py` 建 FastAPI 实例，把 `routers/` 一个个 `include_router(..., prefix="/api")` 挂上；
  要加一类端点，先在这里挂它的 router。
- `models.py` 是**全仓唯一的表定义**（实测 16 张表、9 处唯一约束）。一张表只在这里定义一次，
  别在 router 或 service 里另建第二份。
- `db.py` 给 engine / session / 建库；`__init__.py` 空壳。

**为什么章号到处要搬**：表里存着章号唯一约束与弧起止，所以「序号是位置」那条裁定
（D-29 / D-32）落地时要一起搬的地方，以 `models.py` 为准数；`services/renumber.py`
那份清单必须和它对齐，加一列引用章号就得加一处搬移。

**往下**：HTTP 细节在 `routers/`，业务与模型编排在 `services/`，各有自己的 description.md。
