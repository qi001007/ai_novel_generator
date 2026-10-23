import json
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.main import app
from app.models import ArcPlan, ChapterBrief, ContextWorkflow, Novel, TocEntry
from app.services.context import TIER_FILL, build_writing_context
from app.services.llm import LLMResult, get_llm_client


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


def _book(session, *, arcs=4, arc_length=12, arc_window=12, before=1, after=2):
    novel = Novel(title="滑窗测试", target_chapters=arcs * arc_length)
    session.add(novel)
    session.commit()
    session.refresh(novel)
    for number in range(1, arcs * arc_length + 1):
        session.add(TocEntry(novel_id=novel.id, chapter_number=number, title=f"第{number}章"))
    for index in range(arcs):
        start = index * arc_length + 1
        session.add(
            ArcPlan(
                novel_id=novel.id,
                title=f"弧{index + 1}",
                start_chapter=start,
                end_chapter=start + arc_length - 1,
                objective=f"弧{index + 1}目标",
            )
        )
    session.add(
        ContextWorkflow(
            name="C 滑窗",
            novel_id=novel.id,
            scope_key=f"novel:{novel.id}",
            is_default=True,
            policy={
                "version": 1,
                "budget": 60000,
                "modules": [
                    {
                        "id": "arc",
                        "kind": "arc",
                        "enabled": True,
                        "before": before,
                        "after": after,
                        "arc_window": arc_window,
                        "selection": "all",
                    }
                ],
            },
            graph={},
        )
    )
    session.commit()
    return novel


def _arc_titles(session, novel, chapter):
    ctx = build_writing_context(session, novel.id, chapter)
    return {
        re.search(r"· (.+?)（", block.item.label).group(1)
        for block in ctx.selected
        if block.item.kind == "arc"
    }


def test_arc_window_slides_with_chapter(session):
    novel = _book(session)
    expected = {
        12: {"弧1", "弧2"},
        14: {"弧2"},
        24: {"弧2", "弧3"},
        26: {"弧3"},
        36: {"弧3", "弧4"},
        38: {"弧4"},
    }
    for chapter, arcs in expected.items():
        assert _arc_titles(session, novel, chapter) == arcs, f"第 {chapter} 章弧窗口不对"


def test_future_arc_is_labelled_and_kept_above_fill(session):
    novel = _book(session)
    ctx = build_writing_context(session, novel.id, 12)
    future = next(block for block in ctx.selected if "弧2" in block.item.label)
    assert "未来" in future.item.label
    assert future.tier != TIER_FILL


def test_arc_window_caps_the_number_of_arcs(session):
    novel = _book(session, arcs=20, arc_length=1, arc_window=12, before=10, after=10)
    titles = _arc_titles(session, novel, 10)
    assert len(titles) == 12
    assert titles == {f"弧{index}" for index in range(4, 16)}


class _StubLLM:
    def __init__(self) -> None:
        self.settings = type("Settings", (), {"is_configured": True})()

    def complete(self, task_type, system, user):
        return LLMResult(
            content="滑窗测试正文。",
            model="stub",
            token_input=10,
            token_output=5,
            cost_estimate=0.0,
        )


def test_api_generation_manifest_slides_the_arc_window(client: TestClient, db_engine):
    novel_id = client.post("/api/novels", json={"title": "C 窗 API"}).json()["id"]
    with Session(db_engine) as session:
        for number in range(1, 49):
            session.add(TocEntry(novel_id=novel_id, chapter_number=number, title=f"第{number}章"))
        for index in range(4):
            start = index * 12 + 1
            session.add(
                ArcPlan(
                    novel_id=novel_id,
                    title=f"弧{index + 1}",
                    start_chapter=start,
                    end_chapter=start + 11,
                    objective=f"弧{index + 1}目标",
                )
            )
        session.add(
            ContextWorkflow(
                name="C 滑窗",
                novel_id=novel_id,
                scope_key=f"novel:{novel_id}",
                is_default=True,
                policy={
                    "version": 1,
                    "budget": 60000,
                    "modules": [
                        {
                            "id": "arc",
                            "kind": "arc",
                            "enabled": True,
                            "before": 1,
                            "after": 2,
                            "arc_window": 12,
                            "selection": "all",
                        }
                    ],
                },
                graph={},
            )
        )
        briefs = {}
        for chapter in (12, 14):
            brief = ChapterBrief(novel_id=novel_id, chapter_number=chapter, goal="测试滑窗")
            session.add(brief)
            session.commit()
            session.refresh(brief)
            briefs[chapter] = brief.id

    app.dependency_overrides[get_llm_client] = lambda: _StubLLM()
    try:
        expected = {12: {"弧1", "弧2"}, 14: {"弧2"}}
        for chapter, arcs in expected.items():
            response = client.post(
                f"/api/novels/{novel_id}/chapters/from-brief/{briefs[chapter]}"
            )
            assert response.status_code == 201, response.text
            runs = client.get(f"/api/novels/{novel_id}/generation-runs").json()
            manifest = json.loads(runs[-1]["input_summary"])
            labels = [
                block["label"]
                for block in manifest["blocks"]
                if block["injected"] and block["kind"] == "arc"
            ]
            assert {
                re.search(r"· (.+?)（", label).group(1) for label in labels
            } == arcs
            if chapter == 12:
                assert any("未来" in label for label in labels)
    finally:
        app.dependency_overrides.clear()
