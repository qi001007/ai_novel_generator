"""The tools the agent may reach for, and the boundary it may not cross.

The important negative: there is no write tool. A change to planning leaves the
loop as a proposal for the human to apply, which is what keeps the file layer the
single writer (DECISIONS D-01 / D-15).
"""

import httpx
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models import Novel
from app.services.agent import ToolCall, ToolError
from app.services.agent_tools import build_registry


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Novel(title="测试书", description="玄幻", target_chapters=10, style_constraints=""))
        session.commit()
        novel_id = session.exec(__import__("sqlmodel").select(Novel)).first().id
    factory = lambda: Session(engine)
    factory.novel_id = novel_id  # type: ignore[attr-defined]
    yield factory


def registry_for(session_factory, transport=None):
    return build_registry(session_factory, session_factory.novel_id, search_transport=transport)


# --- the boundary -----------------------------------------------------------


def test_the_agent_is_given_no_way_to_write(session_factory) -> None:
    registry = registry_for(session_factory)
    assert registry.names() == ["list_files", "read_file", "web_search"]
    assert not [name for name in registry.names() if any(word in name for word in ("write", "put", "save", "delete"))]


def test_a_write_call_is_refused_and_changes_nothing(session_factory) -> None:
    from app.services.documents import read_file

    registry = registry_for(session_factory)
    result = registry.run(ToolCall(name="write_file", arguments={"path": "toc.md", "text": "注入内容"}))
    assert result.ok is False
    with session_factory() as session:
        doc = read_file(session, session_factory.novel_id, "toc.md")
    assert "注入内容" not in doc.text


# --- reading the workspace --------------------------------------------------


def test_read_file_returns_the_same_document_the_editor_shows(session_factory) -> None:
    registry = registry_for(session_factory)
    result = registry.run(ToolCall(name="read_file", arguments={"path": "blueprint.md"}))
    assert result.ok is True
    assert "全书蓝图" in result.content


def test_a_path_that_is_not_a_document_comes_back_as_text_not_a_crash(session_factory) -> None:
    registry = registry_for(session_factory)
    result = registry.run(ToolCall(name="read_file", arguments={"path": "nonsense.md"}))
    assert result.ok is False
    assert "nonsense.md" in result.content


def test_list_files_names_the_paths_read_file_accepts(session_factory) -> None:
    registry = registry_for(session_factory)
    listed = registry.run(ToolCall(name="list_files", arguments={}))
    assert listed.ok is True
    assert "arcs.md" in listed.content and "toc.md" in listed.content


# --- the web lookup ---------------------------------------------------------


def wiki_transport(hits):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["srsearch"] == "司天监"
        return httpx.Response(200, json={"query": {"search": hits}})

    return httpx.MockTransport(handler)


def test_search_returns_real_entries_with_their_source(session_factory) -> None:
    registry = registry_for(
        session_factory,
        wiki_transport([{"pageid": 11, "title": "司天监", "snippet": "<em>司天监</em>，官署名。"}]),
    )
    result = registry.run(ToolCall(name="web_search", arguments={"query": "司天监"}))
    assert result.ok is True
    assert "司天监，官署名。" in result.content
    assert "wikipedia" in result.content


def test_no_hits_says_so_instead_of_leaving_a_hole_for_the_model_to_fill(session_factory) -> None:
    registry = registry_for(session_factory, wiki_transport([]))
    result = registry.run(ToolCall(name="web_search", arguments={"query": "司天监"}))
    assert result.ok is True
    assert "没有查到" in result.content


def test_an_upstream_error_becomes_a_tool_failure_the_loop_reports(session_factory) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="blocked")

    registry = registry_for(session_factory, httpx.MockTransport(handler))
    result = registry.run(ToolCall(name="web_search", arguments={"query": "司天监"}))
    assert result.ok is False
    assert "403" in result.content


def test_an_empty_query_is_refused_without_reaching_the_network(session_factory) -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("must not be called")

    registry = registry_for(session_factory, httpx.MockTransport(handler))
    result = registry.run(ToolCall(name="web_search", arguments={"query": "  "}))
    # a refused call comes back as a failed result, and the transport never ran
    assert result.ok is False
    assert "query" in result.content
