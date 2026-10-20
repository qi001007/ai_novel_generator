from app.models import Chapter, Novel
from app.services.context import ContextItem, render_context


# 写整章时唯一的那句系统提示。两条生成路（流式 / 非流式）共用，别在别处再抄一遍。
DRAFT_SYSTEM_PROMPT = (
    "你是中文网文长篇连载作者。严格遵守 A 层约束、C 层剧情弧和 D 层简报，"
    "写出完整章节正文，只输出正文。"
)


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


def build_review_context_prompt(chapter: Chapter, snapshot: dict) -> str:
    """Audit the exact material that was available when this draft was written."""
    return f"""请先只审计本次生成实际注入的上下文，不要审正文。

章号：第 {chapter.chapter_number} 章
生成时上下文快照（不可补读当前数据库）：
{snapshot}

检查快照是否缺少必要信息、互相冲突或存在无法执行的约束。
严格输出 JSON：decision、comments、conflicts、missing、references。
decision 只能是 passed、needs_revision；references 是描述快照来源的数组。
"""


def build_review_body_prompt(chapter: Chapter, snapshot: dict, context_audit: dict) -> str:
    """Audit prose only after the snapshot has passed the first phase."""
    return f"""请根据已确认的上下文快照审计正文，不要改写正文。

章号：第 {chapter.chapter_number} 章
已确认上下文快照：
{snapshot}

第一阶段上下文审计：
{context_audit}

正文：
{chapter.content}

严格输出 JSON 对象，不要 Markdown 解释。
每维分数为 0-100；evidence 中的每条内容必须逐字来自正文。
字段：decision、comments、scores、evidence、suggestions。
suggestions 只放可供作者手动采用的对象数组：quote（正文中唯一且逐字存在的片段）、
replacement（建议替换文本）、comment（理由）。没有安全的唯一锚点就不要给建议。
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
