# backend/scripts/ —— 手动冒烟（pytest 不收集，文件名故意不带 `test_`）

- `writing_ring_smoke.py` —— 可重复的 S1 冒烟：隔离库上走「文件层规划 → 上下文 → 草稿」整圈。
  默认档**不调模型**（用确定性草稿模板），加 `--live` 才真调供应商、才花钱。
- `smoke_chat_stream.py` —— 真跑一轮流式对话，**要先起后端**
  （`.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`），参数就是提问文本。

**规矩**：这里的脚本可以手跑，不许被 `app/` import；要沉淀成回归就搬进 `tests/` 变成用例，
别留一份只有人记得怎么跑的脚本。
