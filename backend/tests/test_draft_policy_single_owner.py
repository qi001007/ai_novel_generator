"""draft 的四条策略必须只有一个主人（候选 1 收口后的防回归）。

形状抄 `uiInvariants.test.ts`：扫源码文本，谁再抄第二份就红。
2026-09-07 的起因：架构走查报"流式 0.8 / 非流式 0.6"，核实后是**同一策略两处各写一次**
（`services/llm.py` 的 task-aware 回退 + `routers/chapters.py` 的字面量）——
今天两边碰巧同值，明天改一处就静默分叉。
"""
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def _sources():
    return {p: p.read_text(encoding="utf-8") for p in APP.rglob("*.py")}


def _total(needle: str) -> int:
    return sum(t.count(needle) for t in _sources().values())


def test_no_call_site_hardcodes_the_draft_temperature():
    assert _total("temperature=0.8") == 0, "温度字面量只能有一个主人：services/llm.py 的 DRAFT_TEMPERATURE"
    assert _total("DRAFT_TEMPERATURE = 0.8") == 1, "DRAFT_TEMPERATURE 的定义必须恰好一处"


def test_draft_system_prompt_has_one_owner():
    assert _total("你是中文网文长篇连载作者") == 1, "系统提示词只许写在 prompts.py 一处"


def test_prose_exists_message_has_one_owner():
    assert _total("该章已有正文") == 1, "409 那句只许写在 services/chapters.py 一处"


def test_offline_draft_model_name_has_one_owner():
    assert _total(chr(34) + "template-v1" + chr(34)) == 1
    assert _total("offline-template") == 0, "离线模型名别在别处再发明一个"
