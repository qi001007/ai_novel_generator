from app.models import ArcPlan, Chapter, ChapterBrief, Novel, PlanningBlueprint


def build_draft_user_prompt(
    novel: Novel,
    blueprint: PlanningBlueprint | None,
    arc: ArcPlan | None,
    brief: ChapterBrief,
) -> str:
    blueprint_text = (
        f"主线：{blueprint.main_line}\n终局：{blueprint.ending}\n"
        f"核心冲突：{blueprint.core_conflicts}\n主题：{blueprint.themes}\n"
        f"约束：{blueprint.constraints}"
        if blueprint
        else "暂无"
    )
    arc_text = (
        f"剧情弧：{arc.title}\n目标：{arc.objective}\n冲突：{arc.conflict}\n"
        f"结果：{arc.resolution}\n状态：{arc.status}"
        if arc
        else "暂无"
    )
    return f"""作品：{novel.title}
文风约束：{novel.style_constraints or "未设置"}

A 层蓝图：
{blueprint_text}

C 层剧情弧：
{arc_text}

D 层章节简报：
章号：第 {brief.chapter_number} 章
本章目标：{brief.goal}
事件：{brief.events}
视角：{brief.pov}
出场人物：{"、".join(brief.characters)}
冲突：{brief.conflict}
结尾钩子：{brief.hook}
必须包含的事实：{"、".join(brief.required_facts)}

请写出一章完整正文，不要输出解释、标题或大纲。
"""


def build_review_user_prompt(chapter: Chapter) -> str:
    return f"""请对以下章节做完整七维自检。

章号：第 {chapter.chapter_number} 章
正文：
{chapter.content}

严格输出 JSON 对象，不要 Markdown 解释。
每维分数为 0-100；evidence 中的每条内容必须逐字来自正文。
字段：
decision、comments、scores、evidence
"""


def build_summary_user_prompt(chapter: Chapter) -> str:
    return f"""请从以下终稿章节提取可用于长程一致性的事实。

章号：第 {chapter.chapter_number} 章
正文：
{chapter.content}

严格输出 JSON 对象，不要 Markdown 解释。
字段：
summary、events、character_state_changes、foreshadow_updates
"""
