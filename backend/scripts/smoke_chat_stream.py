"""Manual smoke: one real streaming chat turn against a running backend.

Usage:
    .venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8000
    .venv\\Scripts\\python.exe scripts\\smoke_chat_stream.py ["提问"]
"""

import json
import os
import sys
import time

import httpx

BASE_URL = os.getenv("NOVEL_SMOKE_BASE_URL", "http://127.0.0.1:8000")
NOVEL_ID = int(os.getenv("NOVEL_SMOKE_NOVEL_ID", "1"))
MODE = os.getenv("NOVEL_SMOKE_MODE", "write")


def main() -> int:
    question = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "用三句话说清这本书当前的主线，并指出一个你自己发现的设定风险。"
    )
    started = time.time()
    pieces: list[str] = []
    deltas = 0

    with httpx.Client(base_url=BASE_URL, timeout=180) as client:
        with client.stream(
            "POST",
            f"/api/novels/{NOVEL_ID}/chat/stream",
            json={"content": question, "mode": MODE, "model": None},
        ) as response:
            if response.status_code != 200:
                print(f"HTTP {response.status_code}: {response.read().decode()[:400]}")
                return 1

            event = ""
            for line in response.iter_lines():
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line.split(":", 1)[1].strip())
                stamp = f"[{time.time() - started:5.1f}s]"

                if event == "context":
                    print(
                        f"{stamp} context: {len(payload['items'])} 项资料"
                        f"，未识别 @引用 {payload['unknown_mentions']}"
                    )
                    for item in payload["items"][:6]:
                        print(f"          {item['score']:>4}  {item['label']}")
                elif event == "delta":
                    deltas += 1
                    pieces.append(payload["text"])
                    if deltas <= 3 or deltas % 40 == 0:
                        print(f"{stamp} delta #{deltas}: {payload['text']!r}")
                elif event == "done":
                    message = payload["message"]
                    print(
                        f"{stamp} done: model={message['model']} "
                        f"in={message['token_input']} out={message['token_output']} "
                        f"id={message['id']}"
                    )
                elif event == "error":
                    print(f"{stamp} error: {payload['message']}")
                    return 1

        streamed = "".join(pieces)
        history = client.get(f"/api/novels/{NOVEL_ID}/chat/messages", params={"limit": 2})
        stored = [row for row in history.json() if row["role"] == "assistant"]
        persisted = stored[-1]["content"] if stored else ""

    print(f"delta 事件数 = {deltas}")
    print(f"流式字数 = {len(streamed)}")
    print("落库内容与流式一致 =", persisted == streamed)
    print("首 40 字 =", streamed[:40].replace("\n", " "))

    if deltas <= 1:
        print("FAIL: 没有逐字增量，疑似整体缓冲")
        return 1
    if not streamed.strip():
        print("FAIL: 空回复")
        return 1
    if persisted != streamed:
        print("FAIL: 落库内容与流式不一致")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
