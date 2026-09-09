# backend/alembic/versions/ —— Alembic revisions

一个 revision 只做一项可说明的结构变化；结构迁移与用户数据改写不得混合。
每条迁移必须有唯一 revision id、正确前驱、可执行 downgrade 和迁移测试。
禁止在启动迁移中自动重编号、删除目录行或改写主人现有内容（D-32）。
