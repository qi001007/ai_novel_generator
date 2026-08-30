from app.models import ChapterBrief


def build_template_draft(brief: ChapterBrief) -> str:
    parts: list[str] = []
    if brief.pov:
        parts.append(f"视角：{brief.pov}")
    if brief.characters:
        parts.append("出场人物：" + "、".join(brief.characters))
    if brief.goal:
        parts.append(brief.goal)
    if brief.events:
        parts.append(brief.events)
    if brief.conflict:
        parts.append(brief.conflict)
    if brief.hook:
        parts.append(brief.hook)
    return "\n".join(parts)
