# backend/app/ —— 后端运行时

main.py 创建 FastAPI 并挂 routers；models.py 定义全部 16 张表；db.py 管 engine/session；
sse.py 统一两条流式端点的事件帧和响应头；__init__.py 只标识包。

业务不写在这一层：HTTP 解析去 routers/，业务、投影和模型编排去 services/。
新增表必须同时考虑迁移、删除范围、快照恢复与测试。
