"""写作上下文窗口与注入清单：REQUIREMENTS 10.2 / 10.3 的验收。"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    ChapterSummary,
    Character,
    ContextWorkflow,
    Foreshadow,
    KnowledgeEntry,
    Novel,
    PlanningBlueprint,
    Setting,
    TocEntry,
)
from app.services.context import (
    ContextBlock,
    ContextItem,
    TIER_CORE,
    TIER_CONTINUITY,
    TIER_FILL,
    TIER_NEARBY,
    apply_context_budget,
    build_chat_context,
    build_writing_context,
    collect_items,
    injection_report,
    log_injection,
    parse_context_manifest,
)
from tests.planning_helpers import create_brief, create_chapter, write_document
from app.services.chat import prepare_turn
from app.services.prompts import build_draft_user_prompt


@pytest.fixture(autouse=True)
def _force_unconfigured_llm(monkeypatch) -> None:
    """Keep the deterministic fallback: LLMSettings.from_env() loads backend/.env into the

    shared os.environ, so any test that touched it earlier would otherwise leak a real key
    into this module and turn the draft call into a live HTTP request.
    """
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as new_session:
        yield new_session


def _book(session):
    """A book whose 25th chapter has a closed previous arc, an open pit and a cast."""
    novel = Novel(title="星渊纪元", style_constraints="克制", target_chapters=120)
    session.add(novel)
    session.commit()
    session.refresh(novel)

    for version, marker in ((1, "主线-旧版"), (2, "主线-新版")):
        session.add(
            PlanningBlueprint(
                novel_id=novel.id,
                version=version,
                main_line=marker,
                ending="终局",
                core_conflicts="冲突",
                themes="主题",
                constraints="不写现代词",
            )
        )

    closed_arc = ArcPlan(
        novel_id=novel.id, title="旧弧", start_chapter=1, end_chapter=20, objective="上一弧目标"
    )
    current_arc = ArcPlan(
        novel_id=novel.id, title="当前弧", start_chapter=21, end_chapter=40, objective="当前弧目标"
    )
    session.add(closed_arc)
    session.add(current_arc)
    session.commit()

    brief = ChapterBrief(
        novel_id=novel.id,
        chapter_number=25,
        goal="夺取碑文",
        characters=["林渊"],
        arc_plan_id=current_arc.id,
    )
    session.add(brief)
    previous = Chapter(novel_id=novel.id, chapter_number=24, content="石门在身后合拢。" * 30)
    session.add(previous)
    session.commit()
    session.refresh(previous)
    session.add(Character(novel_id=novel.id, name="林渊", current_status="重伤未愈"))
    session.add(Character(novel_id=novel.id, name="路人甲", current_status="无关人员"))
    session.add(
        Foreshadow(
            novel_id=novel.id, title="碑文来历", content="尚未交代", planted_chapter=3, status="open"
        )
    )
    session.add(
        Foreshadow(
            novel_id=novel.id,
            title="已回收坑",
            content="早已交代",
            planted_chapter=2,
            status="resolved",
        )
    )
    session.add(
        ChapterSummary(
            novel_id=novel.id,
            chapter_id=previous.id,
            chapter_number=24,
            summary="第 24 章摘要",
        )
    )
    session.add(Setting(novel_id=novel.id, category="力量体系", name="星纹", content="以纹引星"))
    for number in (20, 21, 22, 23, 24, 25, 40):
        session.add(TocEntry(novel_id=novel.id, chapter_number=number, title="第" + str(number) + "章"))
    session.commit()
    return novel, brief


def _window(session, novel, brief, **kwargs):
    return build_writing_context(
        session, novel.id, brief.chapter_number, brief_id=brief.id, **kwargs
    )


def _one(ctx, needle):
    hits = [block for block in ctx.selected if needle in block.item.label]
    assert hits, "missing block matching " + needle
    return hits[0]


def test_open_markdown_sections_are_available_to_context_collection(session):
    novel, brief = _book(session)
    blueprint = session.exec(
        select(PlanningBlueprint)
        .where(PlanningBlueprint.novel_id == novel.id)
        .order_by(PlanningBlueprint.version.desc())
    ).first()
    assert blueprint is not None
    blueprint.custom_sections = [{"label": "创作手记", "content": "让意象保持冷峻。"}]
    brief.custom_sections = [{"label": "情绪曲线", "content": "由冷转热。"}]
    character = session.exec(
        select(Character).where(Character.novel_id == novel.id, Character.name == "林渊")
    ).first()
    assert character is not None
    character.custom_sections = [{"label": "特殊能力", "content": "能听见石头回声。"}]
    session.add(blueprint)
    session.add(brief)
    session.add(character)
    session.commit()

    items = collect_items(session, novel.id)
    texts = [item.text for item in items]
    assert any(item.label.endswith("创作手记") and item.text == "让意象保持冷峻。" for item in items)
    assert any("情绪曲线：由冷转热" in text for text in texts)
    assert any("特殊能力：能听见石头回声" in text for text in texts)


def test_window_carries_previous_brief_full_body_open_pit_and_cast(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    labels = [block.item.label for block in ctx.selected]
    assert any("上一章正文" in label for label in labels)
    assert any("碑文来历" in label for label in labels)
    assert any("林渊" in label for label in labels)


def test_open_pit_is_core_while_resolved_pit_is_only_fill(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert _one(ctx, "碑文来历").tier == TIER_CORE
    assert _one(ctx, "已回收坑").tier == TIER_FILL


def test_cast_character_is_core_and_bystander_is_fill(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert _one(ctx, "人物 · 林渊").tier == TIER_CORE
    assert _one(ctx, "人物 · 路人甲").tier == TIER_FILL


# 批注 30.7 第一条（＝ WORKSTREAM-PLAN §3 P0-2 第三条判据的那一半）：简报点名而人物库
# 精确匹配不上的名字，今天不进任何清单、也不记原因——作者只会看到正文里凭空少一个人。
def test_brief_named_character_without_a_card_is_reported(session):
    novel, brief = _book(session)
    brief.characters = ["林渊", "白衣人"]
    session.add(brief)
    session.commit()
    ctx = _window(session, novel, brief)
    assert ctx.missing_characters == ["白衣人"]
    assert ctx.manifest()["missing_characters"] == ["白衣人"]


def test_fully_matched_cast_adds_nothing_to_the_manifest(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert ctx.missing_characters == []
    assert ctx.manifest()["missing_characters"] == []


def test_terminal_report_names_the_unmatched_cast(session):
    novel, brief = _book(session)
    # 全命中时不许多出一行空话（先量这一份，再改简报）
    assert "未命中人物" not in injection_report(
        _window(session, novel, brief), novel_id=novel.id, chapter_number=25
    )
    brief.characters = ["林渊", "白衣人"]
    session.add(brief)
    session.commit()
    report = injection_report(
        _window(session, novel, brief), novel_id=novel.id, chapter_number=25
    )
    assert "未命中人物：白衣人" in report


def test_current_arc_is_core_and_closed_arc_is_continuity(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert _one(ctx, "当前弧").tier == TIER_CORE
    assert _one(ctx, "旧弧").tier == TIER_CONTINUITY


def test_toc_neighbourhood_beats_distant_entries(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert _one(ctx, "B 目录 · 第 24 章").tier == TIER_NEARBY
    assert _one(ctx, "B 目录 · 第 40 章").tier == TIER_NEARBY


def test_prompt_reads_the_newest_active_blueprint(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    prompt = build_draft_user_prompt(novel, [block.item for block in ctx.selected])
    assert "主线-新版" in prompt
    assert "主线-旧版" not in prompt


def test_core_blocks_survive_a_one_char_budget(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief, budget=1)
    labels = [block.item.label for block in ctx.selected]
    assert any("碑文来历" in label for label in labels), "未回收伏笔被裁，违反 PRD 4.1 不变量"
    assert any("林渊" in label for label in labels), "出场人物状态被裁，违反 PRD 4.1 不变量"
    assert any(label.startswith("D 简报") for label in labels)
    assert any(label.startswith("A 全书蓝图") for label in labels)
    assert ctx.dropped, "预算 1 字时填充档应当被裁掉"
    assert all(block.tier == TIER_CORE for block in ctx.selected)
    assert any("预算不足" in block.reason for block in ctx.dropped)
    assert all(block.reason for block in ctx.dropped), "每个被裁块都要有可解释的原因"


def test_one_budget_trimmer_serves_both_context_modes():
    blocks = [
        ContextBlock(ContextItem("blueprint", "A 蓝图", "主线", ref="blueprint"), TIER_CORE),
        ContextBlock(
            ContextItem("chapter", "上一章结尾", "上一章结尾文本", ref="tail"),
            TIER_CONTINUITY,
        ),
        ContextBlock(ContextItem("setting", "设定", "设定资料内容", ref="setting"), TIER_FILL),
    ]

    trimmed = apply_context_budget(blocks, budget=6)

    assert [block.item.ref for block in trimmed.selected] == ["blueprint"]
    assert trimmed.used == 2
    assert [block.item.ref for block in trimmed.dropped] == ["tail", "setting"]
    assert all("预算不足" in block.reason for block in trimmed.dropped)
    assert "必注入" not in trimmed.selected[0].reason


def test_chat_budget_uses_the_same_core_invariant(session):
    novel, _brief = _book(session)

    ctx, _unknown = build_chat_context(
        session, novel.id, "续写第 25 章", budget=1
    )

    assert ctx.selected, "核心上下文在预算 1 时仍必须保留"
    assert all(block.tier == TIER_CORE for block in ctx.selected)
    assert all(block.tier != TIER_CORE for block in ctx.dropped)
    assert all("预算不足" in block.reason for block in ctx.dropped)


def test_previous_chapter_full_text_is_injected_once(session):
    """The ending of chapter 24 is injected; its full text must not double-pay."""
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    injected = [block.item.ref for block in ctx.selected]
    previous = next(block for block in ctx.selected if block.item.ref.startswith("chapter_previous:"))
    assert len(previous.item.text) >= 240
    assert not any(ref.startswith("chapter:") for ref in injected)

def test_manifest_records_injected_and_cut_blocks(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief, budget=400)
    manifest = json.loads(ctx.manifest_json())
    assert manifest["budget"] == 400
    injected = [block for block in manifest["blocks"] if block["injected"]]
    cut = [block for block in manifest["blocks"] if not block["injected"]]
    assert injected and cut
    assert [block["index"] for block in injected] == list(range(1, len(injected) + 1))
    assert all(block["chars"] > 0 for block in manifest["blocks"])
    assert all(block["excerpt"] for block in manifest["blocks"] if block["injected"])
    assert all(block["reason"] for block in cut)


def test_manifest_reader_accepts_legacy_plain_marker(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert parse_context_manifest(ctx.manifest_json())["budget"] == ctx.budget
    assert parse_context_manifest("ChapterBrief:12") is None
    assert parse_context_manifest("") is None


def test_terminal_report_lists_tier_kind_and_chars(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    report = injection_report(ctx, novel_id=novel.id, chapter_number=brief.chapter_number)
    assert "注入上下文清单" in report
    assert "碑文来历" in report
    assert "必注入" in report


def test_injection_print_is_opt_in(session, monkeypatch, capsys):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    monkeypatch.delenv("NOVEL_CONTEXT_DEBUG", raising=False)
    log_injection(ctx, novel_id=novel.id, chapter_number=brief.chapter_number)
    assert capsys.readouterr().out == ""
    monkeypatch.setenv("NOVEL_CONTEXT_DEBUG", "1")
    log_injection(ctx, novel_id=novel.id, chapter_number=brief.chapter_number)
    assert "注入上下文清单" in capsys.readouterr().out


def test_generation_run_persists_the_manifest(client: TestClient):
    novel_id = client.post("/api/novels", json={"title": "清单落库"}).json()["id"]
    write_document(
        client,
        novel_id,
        "blueprint.md",
        "blueprint",
        {
            "main_line": "主线落库",
            "ending": "",
            "core_conflicts": "",
            "themes": "",
            "constraints": "约束落库",
        },
    )
    create_chapter(client, novel_id, chapter_number=1, content="第一章以钟声中结束。")
    brief = create_brief(
        client,
        novel_id,
        chapter_number=2,
        goal="追查钟声来源",
        characters=["林渊"],
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/from-brief/{brief['id']}",
    )
    assert response.status_code == 201, response.text
    body = response.json()
    manifest = parse_context_manifest(body["generation_run"]["input_summary"])
    assert manifest is not None, "input_summary 必须落可解析的注入清单"
    kinds = {block["kind"] for block in manifest["blocks"]}
    assert {"novel", "blueprint", "brief", "chapter"} <= kinds
    assert any(
        block["kind"] == "chapter" and "第 1 章" in block["label"]
        for block in manifest["blocks"]
    )

def test_chat_write_mode_prints_the_same_manifest(session, monkeypatch, capsys):
    """主人要的回路：写作模式发续写指令，终端立刻列出注入了什么。

    Chat used to call the relevance ranker with no report at all, so the
    conversation path, the one the author actually drives, was invisible.
    """
    novel, _brief = _book(session)
    monkeypatch.setenv("NOVEL_CONTEXT_DEBUG", "1")
    turn = prepare_turn(session, novel, content="续写第 25 章", mode="write")

    printed = capsys.readouterr().out
    assert "注入上下文清单" in printed
    assert "写作模式" in printed
    assert "续写第 25 章" in printed

    manifest = parse_context_manifest(turn.manifest)
    assert manifest is not None, "对话轮次也要把清单落进 generation_run"
    assert manifest["blocks"]
    assert all(block["reason"] for block in manifest["blocks"])


def test_chat_plan_mode_is_labelled_apart(session, monkeypatch, capsys):
    novel, _brief = _book(session)
    monkeypatch.setenv("NOVEL_CONTEXT_DEBUG", "1")
    prepare_turn(session, novel, content="梳理伏笔", mode="plan")
    printed = capsys.readouterr().out
    assert "计划模式" in printed
    assert "写作模式" not in printed


def test_blank_core_blocks_are_reported_missing_not_injected(session):
    """An empty field is not an injection: a blank D-brief must not read as 必注入 0 字."""
    novel, brief = _book(session)
    brief.goal = ""
    brief.characters = []
    session.add(brief)
    session.commit()
    ctx = _window(session, novel, brief)
    assert all(block.chars > 0 for block in ctx.selected), "空内容不得算已注入"
    blank = [b for b in ctx.dropped if b.item.kind == "brief" and b.item.ref == f"brief:{brief.id}"]
    assert blank, "空简报要出现在未注入清单里，而不是隐身"
    assert "必注入" in blank[0].reason and "空" in blank[0].reason
    manifest = json.loads(ctx.manifest_json())
    assert all(b["chars"] > 0 for b in manifest["blocks"] if b["injected"])
    blank_entries = [b for b in manifest["blocks"] if not b["injected"] and b["chars"] == 0]
    assert blank_entries and all(b["reason"] for b in blank_entries), "空块要带原因出现在未注入区"


def test_default_workflow_controls_sources_and_records_identity(session):
    novel, brief = _book(session)
    session.add(
        ContextWorkflow(
            name="只看当前简报",
            novel_id=novel.id,
            scope_key=f"novel:{novel.id}",
            is_default=True,
            policy={
                "version": 1,
                "budget": 10000,
                "modules": [
                    {"id": "blueprint", "kind": "blueprint", "enabled": True},
                    {"id": "author", "kind": "author_instructions", "enabled": False},
                    {"id": "toc", "kind": "toc", "enabled": True, "before": 0, "after": 0},
                    {"id": "briefs", "kind": "briefs", "enabled": True, "before": 0, "after": 0},
                    {"id": "drafts", "kind": "drafts", "enabled": True, "before": 1, "tail_chars": 8},
                    {"id": "characters", "kind": "characters", "enabled": True, "selection": "brief_mentions"},
                    {"id": "worldview", "kind": "worldview", "enabled": False},
                    {"id": "foreshadow", "kind": "foreshadow", "enabled": False},
                ],
            },
            graph={},
        )
    )
    session.commit()
    ctx = _window(session, novel, brief)
    labels = [block.item.label for block in ctx.selected]
    assert any(label.startswith("A 全书蓝图") for label in labels)
    assert any(label == "D 简报 · 第 25 章" for label in labels)
    assert any(label == "正文尾部 · 第 24 章" for label in labels)
    assert not any(label == "作品信息" for label in labels)
    assert not any(label.startswith("伏笔") or label.startswith("设定") for label in labels)
    assert ctx.manifest()["workflow"] == {"id": 1, "name": "只看当前简报"}


def test_default_workflow_draft_tail_is_taken_from_end(session):
    novel, brief = _book(session)
    session.add(
        ContextWorkflow(
            name="短尾正文",
            novel_id=novel.id,
            scope_key=f"novel:{novel.id}",
            is_default=True,
            policy={"version": 1, "budget": 10000, "modules": [
                {"id": "drafts", "kind": "drafts", "enabled": True, "before": 1, "tail_chars": 7}
            ]},
            graph={},
        )
    )
    session.commit()
    ctx = _window(session, novel, brief)
    draft = next(block.item for block in ctx.selected if block.item.kind == "chapter")
    assert draft.text == "石门在身后合拢。"[-7:]
    assert "石门" not in draft.text


def test_no_default_workflow_keeps_existing_window(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    labels = [block.item.label for block in ctx.selected]
    assert any(label.startswith("上一章正文") for label in labels)
    assert any(label.startswith("人物 · 路人甲") for label in labels)


def test_approved_knowledge_entries_enter_context_but_drafts_do_not(session):
    novel, _ = _book(session)
    session.add(KnowledgeEntry(
        novel_id=novel.id, kind="world", name="规则区",
        content="重力可以局部改写。", status="approved",
    ))
    session.add(KnowledgeEntry(
        novel_id=novel.id, kind="character", name="守门人",
        content="知道石门的代价。", status="draft",
    ))
    session.commit()

    items = collect_items(session, novel.id)

    assert any(item.label == "设定库 · 规则区" and "重力可以局部改写" in item.text for item in items)
    assert not any("守门人" in item.label for item in items)
