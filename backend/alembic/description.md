# backend/alembic/ —— 数据库结构变更入口

env.py 从 app/models.py 读取 metadata；versions/ 保存顺序迁移。
模型结构变化必须同批提供 upgrade/downgrade，并用 tests/test_migrations.py 真跑两向。
用户内容重排不是 schema 迁移；章号、弧范围或目录行只能走主人确认的业务动作。
