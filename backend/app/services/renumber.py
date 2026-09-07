"""章号是位置，不是身份（第二十八批批注 6）。

删掉第 5 章，后面的自动前移；中间插一章，后面的自动后移。代价是**凡是写着章号的地方
都得跟着搬** - 只搬 chapter 表会让目录、弧范围、伏笔埋设点、人物出场表全部指错章，
那比留一个空洞更坏。所以这里一次列全，而不是哪里想到改哪里。

不搬的两处，都是刻意的：
- novel.target_chapters 是「打算写多少章」的计数，不是对某一章的引用；
- arc_plan.planned_chapters 只有字段声明，全仓没有一处写它，库里恒为 {}。

这里只有「往后搬 / 往前搬」两种动作，外加一条 densify（把空洞压成 1..N）。

densify 曾经以**自动数据迁移**的身份写在这里，被安全审查驳回、驳回成立：迁移会在
主人没要求的时候重写他的章号与弧范围。2026-09-07 批注 5 把它换成了**他主动按下的
一个键**：先出逐行报告（renumber_plan），他确认了才动手，动手前照例落一份快照。
同一件事，谁按下这个按钮，决定了它是破坏性改写还是他要的一次刷新。
"""

from sqlmodel import Session, select

from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    ChapterSummary,
    Character,
    CharacterAppearance,
    Foreshadow,
    Setting,
    TocEntry,
)

# 带唯一约束 (novel_id, chapter_number) 的那几张表：改号必须按安全顺序，否则
# SQLite 会在语句执行到的那一刻就报 UNIQUE 冲突。
KEYED: tuple[tuple[type, str], ...] = (
    (Chapter, "chapter_number"),
    (ChapterBrief, "chapter_number"),
    (ChapterSummary, "chapter_number"),
    (TocEntry, "chapter_number"),
    (CharacterAppearance, "chapter_number"),
)

# 只是「引用某一章」的地方，没有唯一约束，可空。
REFERENCED: tuple[tuple[type, str], ...] = (
    (Foreshadow, "planted_chapter"),
    (Foreshadow, "expected_payoff_chapter"),
    (Foreshadow, "payoff_chapter"),
    (Character, "expected_start_chapter"),
    (Character, "expected_end_chapter"),
    (Setting, "source_chapter"),
)


def chapter_numbers(session: Session, novel_id: int) -> list[int]:
    """现存的章号，从小到大。"""
    return list(
        session.exec(
            select(Chapter.chapter_number)
            .where(Chapter.novel_id == novel_id)
            .order_by(Chapter.chapter_number)
        ).all()
    )


def vacate(session: Session, novel_id: int, *, number: int) -> int:
    """删掉「第 number 章」在各表里那一行，把号让出来。

    `shift_after` 往前压号的前提是那个号已经空了。chapter / chapter_brief 由
    delete_chapter 自己删，这里补上另外三张带唯一约束的表：目录行、章摘要、
    人物出场记录 - 它们说的都是那一章，章没了留着只会指错。
    这一步一开始就漏了：只删 chapter + brief 的话，删一本有目录行的书直接 500。
    """
    gone = 0
    for model, column in KEYED:
        for row in session.exec(
            select(model).where(
                model.novel_id == novel_id, getattr(model, column) == number
            )
        ).all():
            session.delete(row)
            gone += 1
    session.flush()
    return gone


def shift_after(session: Session, novel_id: int, *, above: int, delta: int) -> int:
    """把这本书里所有大于 `above` 的章号整体挪 `delta`，返回搬动了多少行。

    往后挪（插入）从高往低改，往前挪（删除）从低往高改 - 这样每一步要落的位置
    都已经空出来了。**每改一行就 flush 一次**：攒到最后一起 flush 会被 SQLAlchemy
    合成 executemany、按它自己的顺序发语句，我排好的降序就没了，后移时 3→4 会撞上
    还活着的 4（真机删到第 5 号书第 2 章后面时直接 500，我的第一条测试只有 1 行在
    上面，所以没抓到）。
    弧的起止一起挪，挪完若 start > end 就把 end 收到 start，不留一条倒过来的弧。
    """
    if delta == 0:
        return 0
    moved = 0
    descending = delta > 0
    for model, column in (*KEYED, *REFERENCED):
        rows = list(
            session.exec(
                select(model).where(
                    model.novel_id == novel_id,
                    getattr(model, column) > above,
                )
            ).all()
        )
        rows.sort(key=lambda row: getattr(row, column), reverse=descending)
        for row in rows:
            setattr(row, column, getattr(row, column) + delta)
            session.add(row)
            session.flush()  # 一行一落，顺序才是我排的那个顺序
            moved += 1
    for arc in session.exec(select(ArcPlan).where(ArcPlan.novel_id == novel_id)).all():
        touched = False
        if arc.start_chapter > above:
            arc.start_chapter += delta
            touched = True
        if arc.end_chapter > above:
            arc.end_chapter += delta
            touched = True
        if touched and arc.end_chapter < arc.start_chapter:
            arc.end_chapter = arc.start_chapter
        if touched:
            session.add(arc)
            moved += 1
    session.flush()
    return moved


def renumber_plan(session: Session, novel_id: int) -> dict:
    """「重新编号」的逐行报告：哪一章从几号变几号、弧范围前后各是什么。

    章本来就是按号排的，重排就是「排第 i 的那一章变成 i+1」，所以这张表直接由
    位置算出来，不用试跑一遍。**动手之前必须先给他看这张表** - 28.6b 那条被驳回
    的迁移缺的就是这一步（他当时要的就是逐行报告 + 先落快照）。
    """
    numbers = chapter_numbers(session, novel_id)
    target = list(range(1, len(numbers) + 1))
    changes = [
        {"from": old, "to": new}
        for old, new in zip(numbers, target)
        if old != new
    ]

    def clamp(number: int) -> int:
        """把一个号压回「它前面站着几章」的位置。端点落在空洞上也成立。"""
        if not numbers:
            return number
        below = sum(1 for item in numbers if item < number)
        return max(1, min(len(numbers), below + 1))

    arcs = [
        {
            "id": int(arc.id),
            "title": arc.title,
            "before": [arc.start_chapter, arc.end_chapter],
            "after": [clamp(arc.start_chapter), clamp(arc.end_chapter)],
        }
        for arc in session.exec(
            select(ArcPlan).where(ArcPlan.novel_id == novel_id)
        ).all()
    ]
    return {
        "numbers": numbers,
        "target": target,
        "changes": changes,
        "arcs": [arc for arc in arcs if arc["before"] != arc["after"]],
        "already_contiguous": not changes,
    }


def densify(session: Session, novel_id: int) -> int:
    """把空洞压掉，号排成 1..N。返回搬动了多少行。**只搬号，章名一个字不动。**

    每轮只填一个洞，而且每轮**重算**：一次算完会撞唯一约束 -
    [1,2,5,6] 若同时做 5→3 和 6→4，第二条的落点还站着东西。逐洞前移才稳，
    这条由 test_densify_closes_two_holes_without_colliding 钉住。
    """
    moved = 0
    for _ in range(len(chapter_numbers(session, novel_id)) + 2):
        numbers = chapter_numbers(session, novel_id)
        if not numbers:
            return moved
        present = set(numbers)
        hole = next(
            (number for number in range(1, max(present)) if number not in present),
            None,
        )
        if hole is None:
            return moved
        moved += shift_after(session, novel_id, above=hole, delta=-1)
    raise RuntimeError("densify 没收敛：章号空洞比章数还多，先查数据")
