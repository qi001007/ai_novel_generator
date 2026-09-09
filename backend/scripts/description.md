# backend/scripts/ —— 手动冒烟

writing_ring_smoke.py 在隔离库走规划 → 上下文 → 草稿；默认不调模型，--live 才花 token。
smoke_chat_stream.py 在已启动后端上验证对话 SSE。

脚本不得被 app/ 导入；可重复的缺陷验证应移入 tests/。调用 FastAPI 依赖时显式传 Session。
