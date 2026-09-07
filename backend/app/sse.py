"""Server-Sent Events 的唯一一种帧格式与唯一一份响应头。

2026-09-07 收口前，`routers/chat.py` 与 `routers/chapters.py` 各写了一个编码器（逐字相同）
和一份头，而两份头**已经漂了**：对话流带 `Connection: keep-alive`，正文生成流没带。
两条流本该是同一个东西，现在只有一个主人。
"""
import json

# Dev/prod 代理不被告知就会缓冲 SSE 正文。
HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def encode(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
