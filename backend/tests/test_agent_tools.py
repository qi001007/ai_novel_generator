"""The tools the agent may reach for, and the boundary it may not cross.

The important negative: there is no write tool. A change to planning leaves the
loop as a proposal for the human to apply, which is what keeps the file layer the
single writer (DECISIONS D-01 / D-15).
"""

import json
import re

import httpx
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models import Novel
from app.services.agent import ToolCall, ToolError
from app.services.agent_tools import build_registry
from app.services.chat import PROPOSAL_BLOCK
from app.services.proposal_actions import run_action


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
    # 2026-09-09: the five propose_* tools joined this list. They compile a proposal
    # fence and are not a write path; the negative assertion below is the boundary.
    assert registry.names() == sorted(
        ["list_files", "read_file", "web_search", "propose_arcs", "propose_blueprint",
         "propose_chapter_brief", "propose_character", "propose_toc"]
    )
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
        if request.url.host == "zh.wikipedia.org":
            assert request.url.params["srsearch"] == "司天监"
            return httpx.Response(200, json={"query": {"search": hits}})
        assert request.url.params["action"] == "wbsearchentities"
        assert request.url.params["search"] == "司天监"
        return httpx.Response(200, json={"search": []})
    return httpx.MockTransport(handler)


def test_wikidata_search_uses_entities_api_and_returns_cold_results(session_factory) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "zh.wikipedia.org":
            return httpx.Response(200, json={"query": {"search": []}})
        assert request.url.params["action"] == "wbsearchentities"
        assert request.url.params["search"] == "绝对之门"
        return httpx.Response(200, json={"search": [{
            "id": "Q123", "label": "绝对之门", "description": "一部中文网络小说",
            "concepturi": "http://www.wikidata.org/entity/Q123",
        }]})

    result = registry_for(session_factory, httpx.MockTransport(handler)).run(
        ToolCall(name="web_search", arguments={"query": "绝对之门"})
    )
    assert result.ok is True
    assert "绝对之门" in result.content
    assert "一部中文网络小说" in result.content
    assert "Q123" in result.content

def test_search_returns_real_entries_with_their_source(session_factory) -> None:
    registry = registry_for(
        session_factory,
        wiki_transport([{"pageid": 11, "title": "司天监", "snippet": "<em>司天监</em>，官署名。"}]),
    )
    result = registry.run(ToolCall(name="web_search", arguments={"query": "司天监"}))
    assert result.ok is True
    assert "司天监，官署名。" in result.content
    assert "wikipedia" in result.content


def test_search_merges_sources_and_deduplicates_titles(session_factory) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "zh.wikipedia.org" in str(request.url):
            return httpx.Response(200, json={"query": {"search": [
                {"pageid": 11, "title": "司天监", "snippet": "官署名"},
            ]}})
        return httpx.Response(200, json={"search": [
            {"id": "Q1", "label": "司天监", "description": "同名重复"},
            {"id": "Q2", "label": "古代官署", "description": "另一条"},
        ]})

    result = registry_for(session_factory, httpx.MockTransport(handler)).run(
        ToolCall(name="web_search", arguments={"query": "司天监"})
    )
    assert result.ok is True
    assert result.content.count("司天监") == 2  # heading + one result, not duplicate hits
    assert "古代官署" in result.content
    assert "已合并并去重" in result.content


def test_search_retries_transient_upstream_failure(session_factory) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503, text="temporary")
        if request.url.host == "zh.wikipedia.org":
            return httpx.Response(200, json={"query": {"search": [
                {"pageid": 11, "title": "司天监", "snippet": "官署名"},
            ]}})
        return httpx.Response(200, json={"search": []})

    result = registry_for(session_factory, httpx.MockTransport(handler)).run(
        ToolCall(name="web_search", arguments={"query": "司天监"})
    )
    assert result.ok is True
    assert calls == 3  # retry Wikipedia, then query Wikidata


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

# --- the proposal tools: compile a fence, write nothing ---------------------
# The samples below come from the owner's own screenshots of the model: a B-layer
# entry whose number is 「11-30」, an arc record with no 收束/状态, a chapter 1 brief
# that must read 0001, and a character proposal aimed at settings/characters.md, a
# path that does not exist. Refusing or repairing exactly those is this layer's job.

PROPOSAL_NAMES = [
    "propose_blueprint",
    "propose_toc",
    "propose_arcs",
    "propose_chapter_brief",
    "propose_character",
]

TOC_TWO_CHAPTERS = {
    "chapters": [
        {"number": 1, "title": "开门", "plot_function": "立谜", "notes": "第一把钥"},
        {"number": 2, "title": "验钥", "plot_function": "抬价", "notes": ""},
    ]
}
# What the model actually sent for chapters 11 through 30: one entry, no chapter rows.
TOC_RANGE_ENTRY = {"chapters": [{"number": "11-30", "title": "弧 3：门钥之谜"}]}

FIVE_ACTIONS = [
    (
        "propose_blueprint",
        "blueprint.md",
        {"main_line": "集齐九钥", "ending": "门后无归途", "core_conflicts": "守钥人反扑",
         "themes": "代价", "constraints": "不写死主角结局"},
    ),
    ("propose_toc", "toc.md", TOC_TWO_CHAPTERS),
    (
        "propose_arcs",
        "arcs.md",
        {"arcs": [{"title": "门钥之谜", "start_chapter": 11, "end_chapter": 30}]},
    ),
    ("propose_chapter_brief", "chapters/0001/brief.md",
     {"chapter_number": 1, "goal": "让主角第一次见碑"}),
    ("propose_character", "settings/characters/new.md",
     {"name": "沈砚", "identity": "守钥人末代"}),
]


def proposal_text(session_factory, name: str, value) -> str:
    """Call a proposal tool the way the loop does: one JSON string, no exceptions."""
    result = registry_for(session_factory).run(
        ToolCall(name=name, arguments={"payload": json.dumps(value, ensure_ascii=False)})
    )
    # a refused payload is text the model can act on, never a crash it cannot see
    assert result.ok is True
    return result.content


def fence_path(fence: str) -> str:
    """The path the real parser reads out of a fence, or the test fails loudly."""
    match = PROPOSAL_BLOCK.search(fence)
    assert match is not None, fence
    return match.group(1)


@pytest.mark.parametrize(
    "name", PROPOSAL_NAMES,
)
def test_the_five_proposal_tools_are_registered(session_factory, name) -> None:
    registry = registry_for(session_factory)
    tool = registry.get(name)
    assert tool is not None
    assert name in registry.catalogue()
    # one string argument, so the legacy `--payload "..."` text protocol works too
    assert list(tool.parameters["properties"]) == ["payload"]
    assert tool.parameters["required"] == ["payload"]
    assert "不写库" in tool.description


def test_the_proposal_tools_do_not_reuse_a_write_name(session_factory) -> None:
    registry = registry_for(session_factory)
    assert registry.names() == sorted(["list_files", "read_file", "web_search"] + PROPOSAL_NAMES)
    assert "write_file" not in registry.names()


@pytest.mark.parametrize("name, path, value", FIVE_ACTIONS, ids=[item[0] for item in FIVE_ACTIONS])
def test_every_action_compiles_a_fence_the_proposal_layer_accepts(
    session_factory, name, path, value
) -> None:
    from app.services.documents import validate_structure

    fence = proposal_text(session_factory, name, value)
    assert fence.startswith(f"```markdown @{path}\n"), fence
    assert fence_path(fence) == path
    body = fence.split("\n", 1)[1].rsplit("\n```", 1)[0]
    assert validate_structure(path, body + "\n") == ""


def test_propose_toc_gives_one_keyed_heading_per_chapter(session_factory) -> None:
    fence = proposal_text(session_factory, "propose_toc", TOC_TWO_CHAPTERS)
    headings = [line for line in fence.splitlines() if line.startswith("## ")]
    assert headings == ["## 第 1 章 开门", "## 第 2 章 验钥"]
    for line in headings:
        assert re.fullmatch(r"## 第 \d+ 章 \S.*", line), line


def test_propose_toc_refuses_a_range_entry_and_names_the_fix(session_factory) -> None:
    ok, diagnosis = run_action("update_toc", json.dumps(TOC_RANGE_ENTRY, ensure_ascii=False))
    assert ok is False
    assert "范围" in diagnosis and "update_arcs" in diagnosis
    fence = proposal_text(session_factory, "propose_toc", TOC_RANGE_ENTRY)
    assert fence.startswith("动作未通过校验：")
    assert "```markdown" not in fence


def test_propose_toc_refuses_an_entry_missing_a_field(session_factory) -> None:
    fence = proposal_text(session_factory, "propose_toc",
                          {"chapters": [{"number": 1, "title": "开门"}]})
    assert "plot_function" in fence and "notes" in fence


def test_a_proposal_can_never_choose_its_own_path(session_factory) -> None:
    smuggled = dict(TOC_TWO_CHAPTERS, path="arcs.md")
    fence = proposal_text(session_factory, "propose_toc", smuggled)
    assert fence.startswith("动作未通过校验：")
    assert "path" in fence


def test_propose_arcs_keeps_the_optional_lines(session_factory) -> None:
    fence = proposal_text(session_factory, "propose_arcs",
                          {"arcs": [{"title": "门钥之谜", "start_chapter": 11, "end_chapter": 30}]})
    assert "## 弧 1 门钥之谜" in fence
    assert "- **收束**：" in fence and "- **状态**：" in fence


def test_propose_arcs_refuses_a_moved_chapter_range(session_factory) -> None:
    ok, diagnosis = run_action("update_arcs", {
        "arcs": [{"title": "守钥", "start_chapter": 1, "end_chapter": 7}],
        "existing": [{"arc": 4, "start_chapter": 1, "end_chapter": 5}],
    })
    assert ok is False
    assert "起止章只由主人调整" in diagnosis
    kept = run_action("update_arcs", {
        "arcs": [{"title": "守钥", "start_chapter": 1, "end_chapter": 5}],
        "existing": [{"arc": 4, "start_chapter": 1, "end_chapter": 5, "status": "writing"}],
    })
    assert kept[0] is True
    assert "## 弧 4 守钥" in kept[1]
    assert "- **状态**：writing" in kept[1]  # 省略不等于改写


def test_propose_arcs_judges_keys_against_the_live_file(session_factory) -> None:
    """A fence the preview would refuse must never be handed out (D-39, 35.7)."""
    from app.services import markdown_doc
    from app.services.documents import ACTOR_HUMAN, write_file

    with session_factory() as session:
        write_file(
            session, session_factory.novel_id, "arcs.md",
            markdown_doc.render("arcs", [
                {"arc": 1, "title": "觉醒", "start_chapter": 1, "end_chapter": 5,
                 "objective": "获得能力", "conflict": "追捕", "resolution": "逃亡", "status": "planned"},
                {"arc": 2, "title": "门钥之谜", "start_chapter": 11, "end_chapter": 30,
                 "objective": "集齐九钥", "conflict": "守钥人反扑", "resolution": "", "status": "planned"},
            ]),
            actor=ACTOR_HUMAN,
        )
        session.commit()

    dropped = proposal_text(session_factory, "propose_arcs", {
        "arcs": [{"title": "觉醒", "start_chapter": 1, "end_chapter": 5}],
        "existing": [{"arc": 1, "start_chapter": 1, "end_chapter": 5}],
    })
    assert dropped.startswith("动作未通过校验："), dropped
    assert "```markdown" not in dropped
    assert "不能删除条目" in dropped

    third = proposal_text(session_factory, "propose_arcs", {
        "arcs": [
            {"title": "觉醒", "start_chapter": 1, "end_chapter": 5},
            {"title": "门钥之谜", "start_chapter": 11, "end_chapter": 30},
            {"title": "第九把钥", "start_chapter": 31, "end_chapter": 40},
        ],
        "existing": [
            {"arc": 1, "start_chapter": 1, "end_chapter": 5},
            {"arc": 2, "start_chapter": 11, "end_chapter": 30},
        ],
    })
    assert third.startswith("```markdown @arcs.md"), third
    assert "## 弧 ? 第九把钥" in third


def test_the_arcs_contract_says_the_list_covers_the_whole_book() -> None:
    """35.14：契约从没说过 `arcs` 是全量，实测同一句「新增一条弧」因此撞了四轮。"""
    from app.services.proposal_actions import ACTIONS

    rules = ACTIONS["update_arcs"].rules
    assert "全量" in rules, rules
    assert "按文件里的顺序" in rules, rules
    assert "新弧追加在末尾" in rules, rules


def test_a_moved_range_diagnosis_names_the_way_out() -> None:
    """实测负载：新弧单独放进 `arcs`、已有两弧只写进 `existing`，四次收到同一句话。

    光说「起止章只由主人调整」没有出路——唯一的出路是把已有各弧一并列进 `arcs`。
    """
    ok, diagnosis = run_action("update_arcs", {
        "arcs": [{"title": "第九把钥", "start_chapter": 31, "end_chapter": 40}],
        "existing": [
            {"arc": 1, "start_chapter": 1, "end_chapter": 5},
            {"arc": 2, "start_chapter": 11, "end_chapter": 30},
        ],
    })
    assert ok is False
    assert "把已有各弧一并列进 `arcs`" in diagnosis, diagnosis


def test_propose_chapter_brief_pads_the_chapter_number(session_factory) -> None:
    fence = proposal_text(session_factory, "propose_chapter_brief",
                          {"chapter_number": 1, "goal": "让主角第一次见碑"})
    assert fence_path(fence) == "chapters/0001/brief.md"
    assert "- **章节号**：1" in fence
    assert "## 目标\n让主角第一次见碑" in fence


def test_propose_character_only_ever_targets_new_md(session_factory) -> None:
    fence = proposal_text(session_factory, "propose_character", {"name": "沈砚"})
    assert fence_path(fence) == "settings/characters/new.md"
    assert "settings/characters.md" not in fence
    assert "姓名**：沈砚" in fence


def test_a_refused_card_still_never_writes_anything(session_factory) -> None:
    from app.services.documents import read_file

    registry = registry_for(session_factory)
    with session_factory() as session:
        before = read_file(session, session_factory.novel_id, "toc.md").text
    for name, _path, value in FIVE_ACTIONS:
        registry.run(ToolCall(name=name, arguments={"payload": json.dumps(value, ensure_ascii=False)}))
    registry.run(ToolCall(name="propose_toc", arguments={"payload": "{not json"}))
    with session_factory() as session:
        after = read_file(session, session_factory.novel_id, "toc.md").text
    assert after == before


def test_run_action_reports_a_missing_or_unreadable_action() -> None:
    ok, diagnosis = run_action("delete_chapter", "{}")
    assert ok is False and "delete_chapter" in diagnosis
    assert run_action("update_toc", "") == (
        False,
        "payload 不是合法 JSON：Expecting value: line 1 column 1 (char 0)。"
        "只放一个 JSON 对象，不要加注释、尾逗号或多余文字",
    )


# --- 35.8：写法表发给模型 ---------------------------------------------------


GRAMMAR_MARKER = "本文件写法"


def test_every_kind_with_a_table_hands_the_model_every_label() -> None:
    """两张视图必须出自同一张表：标签由 `grammar_for_kind` 反查，这里不硬编码任何一个。"""
    from app.services import markdown_doc

    for kind in markdown_doc._GRAMMAR:
        table = markdown_doc.grammar_text(kind)
        rows = [row for part in markdown_doc.grammar_for_kind(kind).values() for row in part]
        assert rows, f"{kind} 的语法表空了，这条测试就没有断言可言"
        for row in rows:
            assert f"**{row['label']}**" in table or f"## {row['label']}" in table, (kind, row["label"])
    assert markdown_doc.grammar_text("draft") == "", "正文没有字段表，不该硬造一份"


def test_read_file_appends_the_table_of_the_kind_it_read(session_factory) -> None:
    from app.services import markdown_doc
    from app.services.documents import read_file as docs_read

    registry = registry_for(session_factory)
    for path in ("blueprint.md", "toc.md", "arcs.md",
                 "settings/foreshadow.md", "settings/worldview.md"):
        with session_factory() as session:
            kind = docs_read(session, session_factory.novel_id, path).kind
        result = registry.run(ToolCall(name="read_file", arguments={"path": path}))
        assert result.ok is True, path
        assert GRAMMAR_MARKER in result.content, path
        table = result.content.split(GRAMMAR_MARKER, 1)[1]
        for row in [r for part in markdown_doc.grammar_for_kind(kind).values() for r in part]:
            assert f"**{row['label']}**" in table or f"## {row['label']}" in table, (path, row["label"])


def test_a_document_without_a_table_comes_back_as_the_editor_shows_it(session_factory) -> None:
    """正文一类没有字段书的文档不该被塞进一段表：读到的仍然和编辑器一字不差。"""
    from app.models import Chapter
    from app.services.documents import list_files, read_file

    with session_factory() as session:
        # 直接建章体：空 B 层应用后不建 Chapter 是另一条缺陷（UI-BACKLOG 35.13），不掺进本条。
        session.add(Chapter(novel_id=session_factory.novel_id, chapter_number=1, title="开门"))
        session.commit()
        prose = next(meta.path for meta in list_files(session, session_factory.novel_id)
                     if meta.kind == "draft")
        shown = read_file(session, session_factory.novel_id, prose).text
    result = registry_for(session_factory).run(ToolCall(name="read_file", arguments={"path": prose}))
    assert result.ok is True, result.content
    assert GRAMMAR_MARKER not in result.content
    assert shown in result.content
