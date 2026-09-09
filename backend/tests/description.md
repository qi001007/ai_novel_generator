# backend/tests/ —— 后端行为真相

conftest.py 提供隔离 SQLite；测试不得碰 backend/novel_generator.db 或主人作品。
按资源分 test_*.py；planning_helpers.py 只放测试辅助。

行为变化先写能失败的用例，再改实现。写通路、归属、恢复与 Agent 边界既要钉新路径，
也要反向钉旧路径不能复活。测试通过不替代真网关、真迁移或完整流程冒烟。
