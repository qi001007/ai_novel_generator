"""SSE 的帧格式与响应头必须只有一个主人（候选 2 收口后的防回归，形状同 test_draft_policy_single_owner）。

2026-09-07 实测到的漂移：对话流的响应头带 `Connection: keep-alive`，正文生成流没带——
两条本应同形的流各自维护一份头，改一处就静默不等。
"""
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def _sources() -> dict[str, str]:
    return {str(path).replace("\\", "/"): path.read_text(encoding="utf-8") for path in APP.rglob("*.py")}


def test_frame_literal_has_one_owner():
    hits = {k: t.count(chr(34) + "event: ") for k, t in _sources().items() if t.count(chr(34) + "event: ")}
    assert sum(hits.values()) == 1, f"帧格式只许写在 app/sse.py 一处：{hits}"


def test_stream_headers_have_one_owner():
    text = " ".join(_sources().values())
    assert text.count("X-Accel-Buffering") == 1, "SSE 响应头只许有一份：app/sse.py 的 HEADERS"


def test_both_streams_use_the_shared_header():
    src = _sources()
    chat = [v for k, v in src.items() if k.endswith("routers/chat.py")]
    chapters = [v for k, v in src.items() if k.endswith("routers/chapters.py")]
    assert chat and chapters, "找不到两个流式 router，说明文件被挪动过"
    assert all("sse.HEADERS" in v for v in chat + chapters), "两条流都必须用 app/sse.py 那份头"
