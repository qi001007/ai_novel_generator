# backend/alembic/versions/ 更改账（最新在上）

- 2026-10-20：新增 `j6e7f8a9b0c1`，为旧作品补齐当前 AI 自检 Workflow，并为既有正文流程回填真实模型配置；迁移前有效备份已做 SHA-256 同值校验。

- 2026-10-20：新增终审快照兼容迁移 `h4c5d6e7f8a9`；只为旧库中已经处于 `final` 且没有终审 Revision 的章节补一份不可变快照，避免升级后默认导出突然丢章。
- 2026-10-19：新增 `d1e2f3a4b5c6_add_workflow_revision.py`，为 `context_workflow` 增加默认值为 1 的非空 revision，支持 SQLite 双向迁移。
- 2026-10-18：新增 `agent_run` 与 `tool_call.agent_run_id`，持久化启动页 Agent 请求和待审批工具调用。

- 2026-10-18 · `b9c0d1e2f3a4` 新增统一资产、操作日志、Workflow 运行、对话工具和地图任务表，并为作品补修订、状态、置顶与归档列。

- 2026-09-15 · 开放 Markdown 小节：`planning_blueprint`、`chapter_brief`、`character` 新增 `custom_sections` JSON 列，迁移 `e1a2b3c4d5e6` 提供 upgrade/downgrade，旧行默认空数组。

- 2026-09-11 · 批次 35.34（D-59）：新增 `d8f3b6c05a17_add_chat_message_command_state.py`（`down_revision = 'c4e7a1b8d206'`）。`chat_message` 加一列 `command_state` JSON **NOT NULL** 带 `server_default=sa.text("'{}'")`——与 `steps` 列同一写法，旧行落 `'{}'`。**双向在副本上量过**：`.scratch/probe/3534.db` `upgrade head` → `downgrade` → 再 `upgrade head`，列在／消失／再在。真源库迁移要主人自己在 HANDOFF runbook 里补。

- 2026-09-10 · 批次 31.4（D-50）：新增 `c4e7a1b8d206_add_chat_message_steps.py`（`down_revision = 'b7d4e2a19c53'`）。`chat_message` 加一列 `steps` JSON **NOT NULL** 带 `server_default=sa.text("'[]'")`——加 NOT NULL 列必须给默认，否则库里既有行落不下去；旧行因此是 `[]`，**不回填**（D-50 裁定：历史那几轮的步骤已经没人取证了，编一份出来是第二真源）。**双向都在副本上量过**：`.scratch/probe/mig314.db`（真源库的副本）`upgrade head` → `downgrade` → 再 `upgrade head`，列在／消失／再在。**没碰主人的真源**：同一条命令实测 `backend/novel_generator.db` 仍是 `b7d4e2a19c53` 且 `steps` 不存在——`app/main.py` 与 `app/db.py` 都不在启动跑 alembic，这一列要他自己在 HANDOFF.md:29 那条 runbook 里补。

- 2026-09-09 · 精简说明，保留“禁止启动迁移自动改用户章号”的红线；未改 revision。
- 2026-09-07 · 补聊天线程与 reasoning 相关 revision；撤回自动压缩章号的数据迁移方案。
- 2026-09-06 · 补 app_config、封面颜色与聊天/人物结构 revision。
- 2026-09-15 · 新增 `f4c9d2a7b801_add_context_workflows.py`，创建工作流表、索引、唯一名称和可逆 downgrade。
# 变更记录

- 2026-10-20：新增迁移清理旧 Workflow 节点残留的无意义 `source` 字段，确保升级后的历史流程可按新 Schema 回读。

- 2026-09-16：新增 `a7b8c9d0e1f2`，为 setting/foreshadow 增加 `custom_sections` JSON 列；未执行迁移。
