# backend\tests/ 更改账（最新在上）

- 2026-09-07 · 新建本目录 description.md（主人要求原则贯彻到文件树各层）。本目录代码未改。

- 2026-09-08 · 新增 `test_agent_pydantic.py`：双引擎同契约（流式/推理/预算）、GatewayChatModel
  两条通道、TestModel 三步剧本、只读工具边界、双工具并发与 usage 口径。278 → 290 passed。

- 2026-09-08 · §六 第 2 步新增 8 条：每步耗时与字数（两引擎）、失败工具回给模型而不是抛穿整轮、步闸与 token 闸各自那句中文、一直失败也停在步闸（两引擎）、两引擎 `generation_run` 同量纲。另把 `make_tool()` 的 `type("Tool", (), {...})` 替身换成真 `Tool` 数据类——旧替身把 handler 绑成方法，每一步其实都失败而测试照绿。290 → 298 passed。
