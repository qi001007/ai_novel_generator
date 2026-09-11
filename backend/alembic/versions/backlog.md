# backend/alembic/versions/ 更改账（最新在上）

- 2026-09-11 · 批次 35.34（D-59）：新增 `d8f3b6c05a17_add_chat_message_command_state.py`（`down_revision = 'c4e7a1b8d206'`）。`chat_message` 加一列 `command_state` JSON **NOT NULL** 带 `server_default=sa.text("'{}'")`——与 `steps` 列同一写法，旧行落 `'{}'`。**双向在副本上量过**：`.scratch/probe/3534.db` `upgrade head` → `downgrade` → 再 `upgrade head`，列在／消失／再在。真源库迁移要主人自己在 HANDOFF runbook 里补。

- 2026-09-10 · 批次 31.4（D-50）：新增 `c4e7a1b8d206_add_chat_message_steps.py`（`down_revision = 'b7d4e2a19c53'`）。`chat_message` 加一列 `steps` JSON **NOT NULL** 带 `server_default=sa.text("'[]'")`——加 NOT NULL 列必须给默认，否则库里既有行落不下去；旧行因此是 `[]`，**不回填**（D-50 裁定：历史那几轮的步骤已经没人取证了，编一份出来是第二真源）。**双向都在副本上量过**：`.scratch/probe/mig314.db`（真源库的副本）`upgrade head` → `downgrade` → 再 `upgrade head`，列在／消失／再在。**没碰主人的真源**：同一条命令实测 `backend/novel_generator.db` 仍是 `b7d4e2a19c53` 且 `steps` 不存在——`app/main.py` 与 `app/db.py` 都不在启动跑 alembic，这一列要他自己在 HANDOFF.md:29 那条 runbook 里补。

- 2026-09-09 · 精简说明，保留“禁止启动迁移自动改用户章号”的红线；未改 revision。
- 2026-09-07 · 补聊天线程与 reasoning 相关 revision；撤回自动压缩章号的数据迁移方案。
- 2026-09-06 · 补 app_config、封面颜色与聊天/人物结构 revision。
