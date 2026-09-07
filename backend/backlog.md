# backend/ 更改账（最新在上）

一条一行：日期 · 批次批注 · 一句话 + 提交哈希。细节在提交信息里，别往这里抄。

- 2026-09-07 · 29.4 · `renumber.py` 加 `densify()` 与 `renumber_plan()`；
  `chapters.py` 加两条路由（报告在前、动手在后）。`c4fe78d`
- 2026-09-07 · 29.3 · `llm.stream_messages` 开 `channels` 第二条通道；
  `agent.py` 发 reasoning 事件；`chat.stream_turn` 转成 SSE。`def07de`
- 2026-09-07 · 29.2 · `chat.py` 加 `list_conversations()` 与 `GET /chat/conversations`。`b3658b1`
- 2026-09-07 · 29.1 · `storage.py`：快照记下范围（book/chapter/room/renumber）、
  排序键改成时间戳那一段、新增 `snapshot_chapters` / `restore_chapter` /
  `_merge_toc_row`，并修掉一处与 26.7 同形状的快照句柄泄漏。`448bc67`
- 2026-09-06 · 28.6 / 28.7 / 28.8 · 章号=位置、恢复弹回原位、conversation_id。
  逐条见 `git log --oneline -- backend/`。

- 2026-09-07 · 贯彻「每层一份 description.md」：新建 `app/` `app/routers/` `app/services/` `tests/` `scripts/` `alembic/` `alembic/versions/` 七份说明（各 5-13 行）与对应 `backlog.md`；本目录 `description.md` 24 → 17 行（细节下沉，不再重复子目录内容）。新增机械检查 `tests/test_folder_docs.py`（4 条，实扫 11 个目录）。**本目录代码未改**，只加了一份测试。
- 2026-09-07 · 接 living-docs-governance：`tests/test_folder_docs.py` 再加两条防漂移断言（DECISIONS §0 索引与正文编号必须一一对应；四角色接线不许被拆），做过变异验证（抽掉一行索引立刻红）。本目录代码仍未改，测试数 260 → 262。
