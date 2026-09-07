# app/routers/ —— HTTP 边界（15 个模块 = 15 类资源）

`novels chapters documents planning backups chat settings llm export reviews
summaries characters generation_runs config`，一个资源一份。路由只做三件事：
解析入参、调 `services/`、把领域错误映射成状态码。**这里不写业务、不直接查库。**

**四条不能破的**（理由在 `docs/DECISIONS.md`）：
- `/planning/*` 只读，写请求一律 410。四层规划的唯一写通路是 `documents.py` 里那条
  `PUT /api/novels/{id}/files/{path}`（D-01），新建章与新建简报也走它，不许开第二条。
- 恢复只有一条：`POST /api/backups/restore/chapter` 一次带回简报 + 正文 + 目录行（D-30）。
- 界面上写着「未开放」的动作，后面就不该存在端点：改章号、中间插入章节都没开（D-13）。
- 六个 `HTTPException(status_code=..., detail=...)` 收成一个：`raise HTTPException(**errors.http_kwargs(cause))`。 别再在某个 router 里手写第三种 detail 形状。

- 409 这类拒绝必须走错误样式回给前端，不许伪装成成功回执（第二十六批批注 4）。
