# backend\app\services/ 更改账（最新在上）

- 2026-09-07 · 新建本目录 description.md（主人要求原则贯彻到文件树各层）。本目录代码未改。

- 2026-09-08 · §六 第 1 步后端落地：`agent.py` 加 `NOVEL_AGENT_ENGINE` 开关与 Pydantic 分派；
  新增 `agent_model.py`（GatewayChatModel + 流式事件翻译）与 `agent_pydantic.py`（事件桥/预算映射）；
  `agent_tools.py` 增加同一批只读工具的框架声明。后端 278 → 290 passed。

- 2026-09-08 · §六 第 2 步：预算只剩框架那一道 `BudgetGate(UsageLimits)`（记用量与是哪道闸，不自行判断），到闸那句改成说清「第几轮停 / 已花多少（输入·输出分列）/ 跑了几步」；`AgentStep` 加 `ms` 与派生的 `chars`，两条引擎都量；`第 N 步` 统一成「第 N 次工具调用」（原来非流式那一路按请求编号，一轮里两次调用会重号）。`agent_tools.py` 删掉与注册表逐字重复的 `build_framework_tools`，框架声明统一由 `framework_tools_from_registry(注册表, 计时表)` 生成，工具失败经 `ToolFailed` 回给模型；`chat.py` 的 SSE `tool` 事件多带 `ms`/`chars`。后端 290 → 298 passed。
