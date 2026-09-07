# backend/alembic/ —— 库结构的唯一改动通道

`env.py` 读 `app/models.py` 的 metadata；迁移文件在 `versions/`。
改了 `models.py` 必须同批加一条 revision，`upgrade` 与 `downgrade` 两头都要真能跑
（`tests/test_migrations.py` 钉着）。数据类迁移门槛更高，见 `versions/description.md`。
