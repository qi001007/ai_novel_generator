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

