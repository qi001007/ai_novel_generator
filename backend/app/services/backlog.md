# backend\app\services/ 更改账（最新在上）

- 2026-09-07 · 新建本目录 description.md（主人要求原则贯彻到文件树各层）。本目录代码未改。

- 2026-09-08 · §六 第 1 步后端落地：`agent.py` 加 `NOVEL_AGENT_ENGINE` 开关与 Pydantic 分派；
  新增 `agent_model.py`（GatewayChatModel + 流式事件翻译）与 `agent_pydantic.py`（事件桥/预算映射）；
  `agent_tools.py` 增加同一批只读工具的框架声明。后端 278 → 290 passed。
