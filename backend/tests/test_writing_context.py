"""写作上下文窗口与注入清单：REQUIREMENTS 10.2 / 10.3 的验收。"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    ChapterSummary,
    Character,
    Foreshadow,
    Novel,
    PlanningBlueprint,
    Setting,
    TocEntry,
)
from app.services.context import (
    TIER_CORE,
    TIER_CONTINUITY,
    TIER_FILL,
    TIER_NEARBY,
    build_writing_context,
    injection_report,
    log_injection,
    parse_context_manifest,
)
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


def test_window_carries_previous_ending_open_pit_and_cast(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    labels = [block.item.label for block in ctx.selected]
    assert any("上一章结尾" in label for label in labels)
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


def test_current_arc_is_core_and_closed_arc_is_continuity(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert _one(ctx, "当前弧").tier == TIER_CORE
    assert _one(ctx, "旧弧").tier == TIER_CONTINUITY


def test_toc_neighbourhood_beats_distant_entries(session):
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    assert _one(ctx, "B 目录 · 第 24 章").tier == TIER_NEARBY
    assert _one(ctx, "B 目录 · 第 40 章").tier == TIER_FILL


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


def test_previous_chapter_text_is_not_injected_twice(session):
    """The ending of chapter 24 is injected; its full text must not double-pay."""
    novel, brief = _book(session)
    ctx = _window(session, novel, brief)
    injected = [block.item.ref for block in ctx.selected]
    assert any(ref.startswith("chapter_tail:") for ref in injected)
    assert not any(ref.startswith("chapter:") for ref in injected)
    cut = [block for block in ctx.dropped if block.reason == "与已注入的上一章结尾重复"]
    assert len(cut) == 1

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
    client.post(
        f"/api/novels/{novel_id}/planning/blueprints",
        json={"version": 3, "main_line": "主线落库", "constraints": "约束落库"},
    )
    client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "第一章以钟声中结束。"},
    )
    brief = client.post(
        f"/api/novels/{novel_id}/planning/briefs",
        json={"chapter_number": 2, "goal": "追查钟声来源", "characters": ["林渊"]},
    ).json()

    response = client.post(
        f"/api/novels/{novel_id}/chapters/from-brief/{brief['id']}",
    )
    assert response.status_code == 201, response.text
    body = response.json()
    manifest = parse_context_manifest(body["generation_run"]["input_summary"])
    assert manifest is not None, "input_summary 必须落可解析的注入清单"
    kinds = {block["kind"] for block in manifest["blocks"]}
    assert {"novel", "blueprint", "brief", "chapter"} <= kinds
    assert any("上一章结尾" in block["label"] for block in manifest["blocks"])
