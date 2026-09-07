# backend/tests/ —— 后端行为的地面真相（42 个文件）

一个功能一个 `test_*.py`，`conftest.py` 负责隔离：每个用例跑在 `tmp_path` 下的
独立 SQLite（或 `sqlite://` 内存库）上，**不碰 `backend/novel_generator.db`，不碰主人的书**。

**改代码的配套要求**：改了行为就改断言，不许删断言（AGENTS.md 第 3 步）。凡「写通路」被
推翻的改动，测试要钉住新通路 **并反向钉旧通路不许回来**（例：410 那条、D-30 的一次调用）。
**别把「测试全绿」说成「功能已实现」**：Agent 至今无写工具、无多步循环，缺口清单在
`docs/ARCHITECTURE.md`。
**要看注入了什么**：起服务带 `NOVEL_CONTEXT_DEBUG=1`，清单打到终端（`docs/HANDOFF.md`）。
本目录不放手动脚本，那在 `backend/scripts/`。
