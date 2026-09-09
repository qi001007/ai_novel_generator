# backend/app/routers/ —— HTTP 边界

每个模块对应一种资源：作品、规划、章节、审稿、设定、人物、对话、文档、导出、备份、配置等。
路由只解析输入、做归属检查、调用 services，并把领域错误映射成稳定 HTTP 形状。

规划写路由必须返回 410；唯一写口是 documents 的 PUT /novels/{id}/files/{path}。
恢复一章只暴露一个动作；未开放功能不新增假端点。错误统一走 services/errors.py。
