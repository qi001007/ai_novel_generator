from app.models import Chapter, Novel
from app.services.context import ContextItem, render_context


def build_draft_user_prompt(novel: Novel, items: list[ContextItem]) -> str:
    """Render the writing window. Selecting what goes in is build_writing_context's job.

    Keeping this a pure renderer is what stops the draft path from growing its own
    private idea of "the right context" again (PRD 6.1).
    """
    return f"""作品：{novel.title}
文风约束：{novel.style_constraints or "未设置"}

以下是本次写作可依据的全部资料，按写作优先级排列；严格遵守其中的约束，
不要采用「未回收伏笔」之外另起的新设定。

{render_context(items)}

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
