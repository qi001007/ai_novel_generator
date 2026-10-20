"""The four planning layers projected onto editable Markdown documents."""

import re

import pytest
from fastapi.testclient import TestClient

from tests.planning_helpers import create_arc, create_brief, create_setting, create_toc
from app.services.markdown_doc import render


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed_novel(client: TestClient, title: str = "文档层") -> int:
    novel_id = client.post("/api/novels", json={"title": title}).json()["id"]
    create_toc(
        client,
        novel_id,
        chapter_number=42,
        title="星渊碑影",
        plot_function="揭示碑的来历",
        notes="两\n行",
    )
    create_arc(
        client,
        novel_id,
        title="卷一",
        start_chapter=10,
        end_chapter=60,
        objective="立起目标",
    )
    create_brief(
        client,
        novel_id,
        chapter_number=42,
        goal="揭开星渊碑",
        pov="沈曜",
        characters=["沈曜"],
    )
    return novel_id


def read(client: TestClient, novel_id: int, path: str) -> dict:
    response = client.get(f"/api/novels/{novel_id}/files/{path}")
    assert response.status_code == 200, response.text
    return response.json()


def write(client: TestClient, novel_id: int, path: str, text: str, **kwargs):
    return client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={"text": text, **kwargs},
    )


def test_file_tree_lists_the_planning_layers(client: TestClient) -> None:
    novel_id = seed_novel(client)

    files = client.get(f"/api/novels/{novel_id}/files").json()

    assert [item["path"] for item in files] == [
        "blueprint.md",
        "toc.md",
        "arcs.md",
        "chapters/0042/draft.md",
        "chapters/0042/brief.md",
        # 帧 26: the settings library sits beside the four layers, and the books are
        # always there - an empty one is a page to fill, not a missing file.
        "settings/foreshadow.md",
        "settings/worldview.md",
    ]
    assert [(item["path"], item["layer"]) for item in files][-2:] == [
        ("settings/foreshadow.md", "设定"),
        ("settings/worldview.md", "设定"),
    ]
    assert [item["layer"] for item in files] == ["A", "B", "C", "正文", "D", "设定", "设定"]


def test_documents_render_as_markdown(client: TestClient) -> None:
    novel_id = seed_novel(client)

    toc = read(client, novel_id, "toc.md")["text"]
    assert "## 第 42 章 星渊碑影" in toc
    assert "- **剧情功能**：揭示碑的来历" in toc
    # A multi-line value stays readable: the tail hangs under its own bullet.
    assert "- **备注**：两\n  行" in toc

    brief = read(client, novel_id, "chapters/0042/brief.md")
    assert brief["ai_fields"] == [
        "goal",
        "events",
        "pov",
        "characters",
        "conflict",
        "hook",
        "required_facts",
        "status",
    ]
    assert "- **出场人物**：\n  - 沈曜" in brief["text"]
    assert "## 目标\n揭开星渊碑" in brief["text"]


def test_rendering_a_document_untouched_writes_nothing(client: TestClient) -> None:
    """The round trip is the proof that structure survived the format change."""
    novel_id = seed_novel(client)

    for path in ("blueprint.md", "toc.md", "arcs.md", "chapters/0042/brief.md"):
        doc = read(client, novel_id, path)
        again = write(client, novel_id, path, doc["text"], actor="human")
        assert again.status_code == 200, (path, again.text)
        assert again.json()["changed"] == [], path
        assert again.json()["revision"] == doc["revision"], path
        assert read(client, novel_id, path)["text"] == doc["text"], path


def test_human_edit_writes_back_to_the_database(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.md")

    response = write(
        client,
        novel_id,
        "blueprint.md",
        doc["text"].replace("## 主线\n\n", "## 主线\n沈曜要解开碑名之谜\n\n", 1),
    )

    assert response.status_code == 200
    assert response.json()["changed"] == ["main_line"]
    blueprint = client.get(f"/api/novels/{novel_id}/planning/blueprints").json()[0]
    assert blueprint["main_line"] == "沈曜要解开碑名之谜"
    assert "沈曜要解开碑名之谜" in read(client, novel_id, "blueprint.md")["text"]


def test_ai_may_change_values_but_never_structure(client: TestClient) -> None:
    novel_id = seed_novel(client)
    path = "chapters/0042/brief.md"
    doc = read(client, novel_id, path)
    allowed_text = doc["text"].replace("## 目标\n揭开星渊碑", "## 目标\n碑名会吃人", 1)

    allowed = write(client, novel_id, path, allowed_text, actor="ai")
    assert allowed.status_code == 200
    assert allowed.json()["changed"] == ["goal"]

    for label, text in [
        ("primary key", doc["text"].replace("- **章节号**：42", "- **章节号**：43")),
        ("renamed heading", doc["text"].replace("## 钩子", "## 钩子改名")),
        ("renamed label", doc["text"].replace("- **状态**：", "- **当前状态**：")),
        ("dropped label", "\n".join(l for l in doc["text"].splitlines() if not l.startswith("- **状态**："))),
        ("arc link", doc["text"].replace("- **所属弧**：—", "- **所属弧**：7")),
    ]:
        refused = write(client, novel_id, path, text, actor="ai")
        assert refused.status_code == 422, (label, refused.text)

    assert read(client, novel_id, path)["text"] == allowed_text


def test_ai_may_append_rows_but_never_delete_or_renumber_them(client: TestClient) -> None:
    # 批次 35.7 / D-39 把原断言的「AI 不能增」一半推翻；「不能删、不能改号」仍在。
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "toc.md")
    appended = doc["text"] + "\n## 第 43 章 新章\n- **剧情功能**：\n- **备注**：\n"

    added = write(client, novel_id, "toc.md", appended, actor="ai")
    assert added.status_code == 200, added.text
    assert "43.created" in added.json()["changed"]
    # D-39：目录新增一章，左侧树就要立刻出现这一章。
    numbers = [
        row["chapter_number"] for row in client.get(f"/api/novels/{novel_id}/chapters").json()
    ]
    assert numbers == [42, 43], numbers

    dropped = write(client, novel_id, "toc.md", doc["text"], actor="ai")
    assert dropped.status_code == 422
    assert "不能删除条目" in dropped.text
    # 35.14：光拒绝不给出路，模型就会拿同一条负载再撞几轮
    assert "一并列全" in dropped.text

    renumbered = write(
        client, novel_id, "toc.md", doc["text"].replace("## 第 42 章", "## 第 99 章"), actor="ai"
    )
    assert renumbered.status_code == 422
    assert "不能删除条目" in renumbered.text

    human = write(client, novel_id, "toc.md", appended, actor="human")
    assert human.status_code == 200
    rows = client.get(f"/api/novels/{novel_id}/planning/toc").json()
    assert [row["chapter_number"] for row in rows] == [42, 43]


def test_the_first_chapter_added_to_an_empty_toc_also_creates_the_chapter(
    client: TestClient,
) -> None:
    """35.13 / D-39：空目录里确认「第一章」，左侧树就要出现第一章本体。

    上面那条测的是**已有条目再追加**的分支；作品 6 的首次规划走的是空文件那条分支，
    那里只建了 `TocEntry`，主人说「创建第一章」后树仍然是 0 章。
    """
    novel_id = client.post("/api/novels", json={"title": "空目录首章"}).json()["id"]
    empty = read(client, novel_id, "toc.md")["text"]
    assert "## 第" not in empty, empty

    added = write(
        client,
        novel_id,
        "toc.md",
        empty.rstrip("\n") + "\n\n## 第 1 章 开门\n- **剧情功能**：立谜\n- **备注**：第一把钥\n",
        actor="ai",
    )

    assert added.status_code == 200, added.text
    assert "1.created" in added.json()["changed"]
    numbers = [row["chapter_number"] for row in client.get(f"/api/novels/{novel_id}/chapters").json()]
    assert numbers == [1], numbers
    files = client.get(f"/api/novels/{novel_id}/files").json()
    assert any(item["path"] == "chapters/0001/draft.md" for item in files), files


def test_the_preview_card_and_the_write_gate_are_one_judgment(client: TestClient) -> None:
    """35.7：预览给出可点的卡，PUT 必须接受同一张卡；分歧本身就是缺陷。

    变体全部从「这本书自己的当前文本」做字符串手术得到：`弧 N` 的主键由数据库按行分配，
    拿另一本书渲染出的正文来比，比的是两回事。
    """
    from app.services.chat import extract_proposals

    def verdicts(path: str, body: str, case: int) -> tuple[bool, bool]:
        novel_id = seed_novel(client, f"同源判定{case}")
        live = read(client, novel_id, path)["text"]
        cards = extract_proposals(f"```markdown @{path}\n{body}\n```", lambda p: live)
        card = next((item for item in cards if item["path"] == path), None)
        preview_ok = card is not None and card["valid"] is True
        card_text = card["text"] if card is not None else body
        put_ok = write(client, novel_id, path, card_text, actor="ai").status_code == 200
        return preview_ok, put_ok

    novel_id = seed_novel(client)
    toc_live = read(client, novel_id, "toc.md")["text"]
    arcs_live = read(client, novel_id, "arcs.md")["text"]
    toc_head, arcs_head = toc_live.split("\n## ", 1)[0], arcs_live.split("\n## ", 1)[0]

    for index, (path, body) in enumerate([
        ("toc.md", toc_live),
        ("toc.md", toc_live + "\n## 第 43 章 新章\n- **剧情功能**：\n- **备注**：\n"),
        ("toc.md", toc_live.replace("## 第 42 章", "## 第 99 章")),
        ("toc.md", toc_head),
        ("arcs.md", arcs_live),
        (
            "arcs.md",
            arcs_live + "\n## 弧 ? 卷二\n- **起始章**：61\n- **结束章**：70\n- **目标**：\n"
            "- **冲突**：\n- **收束**：\n- **状态**：planned\n",
        ),
        ("arcs.md", arcs_live.replace("## 弧 1", "## 弧 9")),
        ("arcs.md", arcs_head),
    ]):
        preview_ok, put_ok = verdicts(path, body, index)
        assert preview_ok == put_ok, (path, body)


def test_a_renumbered_proposal_is_repaired_before_it_becomes_a_card(client: TestClient) -> None:
    """改主键的提案不会变成一张改主键的卡：抽提案时按当前文件把键还原（D-39）。"""
    from app.services.chat import extract_proposals

    novel_id = seed_novel(client, "改号还原")
    live = read(client, novel_id, "toc.md")["text"]
    renumbered = live.replace("## 第 42 章", "## 第 99 章")

    card = extract_proposals(f"```markdown @toc.md\n{renumbered}\n```", lambda p: live)[0]
    assert card["valid"] is True, card
    assert "## 第 42 章 星渊碑影" in card["text"] and "第 99 章" not in card["text"], card["text"]
    applied = write(client, novel_id, "toc.md", card["text"], actor="ai")
    assert applied.status_code == 200, applied.text
    assert applied.json()["changed"] == []
    # 原始文本仍然被写入层拒绝：还原发生在提案侧，不是给文件侧开后门。
    assert write(client, novel_id, "toc.md", renumbered, actor="ai").status_code == 422


def test_owner_applied_ai_proposal_can_initialize_toc_and_arcs(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "首次规划"}).json()["id"]
    toc = render("toc", [{
        "chapter": 1, "title": "第一道门", "plot_function": "建立目标", "notes": "",
    }])
    arcs = render("arcs", [{
        "arc": 1, "title": "觉醒", "start_chapter": 1, "end_chapter": 5,
        "objective": "获得能力", "conflict": "追捕", "resolution": "逃亡", "status": "planned",
    }])

    toc_response = write(client, novel_id, "toc.md", toc, actor="ai")
    arcs_response = write(client, novel_id, "arcs.md", arcs, actor="ai")

    assert toc_response.status_code == 200, toc_response.text
    assert arcs_response.status_code == 200, arcs_response.text
    assert "## 第 1 章 第一道门" in read(client, novel_id, "toc.md")["text"]
    assert "## 弧 1 觉醒" in read(client, novel_id, "arcs.md")["text"]


def test_initial_arc_proposal_repairs_common_aliases_and_missing_defaults(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "弧别名"}).json()["id"]
    proposal = (
        "# 剧情弧（C 层）\n\n"
        "> `弧 N` 是主键。\n\n"
        "## 弧 1 觉醒·逃亡\n"
        "- **起止章节**：第 01 - 05 章\n"
        "- **核心事件**：主角获得能力\n"
        "- **弧内悬念**：谁在追捕主角\n"
        "- **人物弧光**：从普通人走向觉醒者\n"
    )

    response = write(client, novel_id, "arcs.md", proposal, actor="ai")

    assert response.status_code == 200, response.text
    saved = read(client, novel_id, "arcs.md")["text"]
    for label in ("起始章", "结束章", "目标", "冲突", "收束", "状态"):
        assert f"- **{label}**：" in saved
    assert "人物弧光：从普通人走向觉醒者" in saved


def test_canonicalization_keeps_the_unassigned_arc_heading(client: TestClient) -> None:
    # 批次 35.12：`弧 ?` 是 `_ARC_ANCHOR` 与编译器都认可的「主键请系统分配」写法，
    # 规范化曾把它的标题整行删空，字段并进上一条弧，卡片必判「多出 起始章」且永远按不了。
    from app.services.documents import canonicalize_proposal, load_document

    novel_id = seed_novel(client)
    current = read(client, novel_id, "arcs.md")["text"]
    proposal = (
        current.rstrip("\n") + "\n\n"
        "## 弧 ? 门钥之谜\n"
        "- **起始章**：61\n"
        "- **结束章**：100\n"
        "- **目标**：追寻玄赿之门\n"
        "- **冲突**：门后是什么\n"
        "- **收束**：\n"
        "- **状态**：planned\n"
    )

    repaired = canonicalize_proposal("arcs.md", proposal, current_text=current)

    headings = [line for line in repaired.splitlines() if line.startswith("## 弧 ")]
    assert len(headings) == 2, repaired
    assert headings[-1].endswith("门钥之谜"), repaired
    # 标题还在，字段才不会并进上一条弧：这就是主人看到的「多出 起始章」的来源。
    rows = load_document("arcs", repaired)
    assert [row.get("arc") for row in rows] == [1, None], rows


def test_ai_may_append_an_arc_with_the_unassigned_key(client: TestClient) -> None:
    # D-39：「写成 ? 由系统分配」这句承诺过去写在四处文案里、实现在零处。
    novel_id = seed_novel(client)
    current = read(client, novel_id, "arcs.md")["text"]
    appended = current.rstrip("\n") + (
        "\n\n## 弧 ? 门钥之谜\n- **起始章**：61\n- **结束章**：100\n"
        "- **目标**：追寻玄赿之门\n- **冲突**：门后是什么\n- **收束**：\n- **状态**：planned\n"
    )

    added = write(client, novel_id, "arcs.md", appended, actor="ai")

    assert added.status_code == 200, added.text
    saved = read(client, novel_id, "arcs.md")["text"]
    headings = [line for line in saved.splitlines() if line.startswith("## 弧 ")]
    assert len(headings) == 2, saved
    assert headings[0].startswith("## 弧 1 "), saved
    assert not any(" ? " in line for line in headings), saved
    assert headings[1].endswith("门钥之谜"), saved

    self_numbered = write(
        client,
        novel_id,
        "arcs.md",
        current.rstrip("\n") + "\n\n## 弧 9 门钥之谜\n- **起始章**：61\n- **结束章**：100\n"
        "- **目标**：x\n- **冲突**：y\n- **收束**：\n- **状态**：planned\n",
        actor="ai",
    )
    assert self_numbered.status_code == 422
    assert "由系统分配" in self_numbered.text


def test_ai_may_not_move_arc_bounds_but_may_rewrite_prose(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "arcs.md")
    arc = doc["text"].splitlines()[4]
    arc_id = arc.split("弧 ")[1].split(" ")[0]

    moved = write(
        client, novel_id, "arcs.md", doc["text"].replace("- **起始章**：10", "- **起始章**：12"), actor="ai"
    )
    assert moved.status_code == 422

    retitled = write(
        client, novel_id, "arcs.md", doc["text"].replace(f"{arc}\n", f"{arc}·观星\n"), actor="ai"
    )
    assert retitled.status_code == 200, retitled.text
    assert retitled.json()["changed"] == [f"{arc_id}.title"]


# 批次 35.1：主人报的是「提案卡出现、点应用报错且内容不变」，报错原文
# `「弧 1 觉醒·逃亡」 的小节标题与字段名是结构标识，不可增删改名：缺少 收束、状态`。
# 模型整本重新生成时只写它在改的那个字段，其余字段应当从文件里那一条继承回来。


def _two_arc_novel(client: TestClient) -> tuple[int, str]:
    # 不用 seed_novel：它那条弧的 冲突/收束 是空串，「省略不等于清空」就没有可断言的值。
    novel_id = client.post("/api/novels", json={"title": "C 层重新生成"}).json()["id"]
    create_arc(
        client,
        novel_id,
        title="卷一",
        start_chapter=10,
        end_chapter=60,
        objective="立起目标",
        conflict="追捕",
        resolution="逃亡",
    )
    create_arc(
        client,
        novel_id,
        title="卷二",
        start_chapter=61,
        end_chapter=100,
        objective="追寻玄赿之门",
        conflict="门后是什么",
        resolution="开门",
    )
    doc = read(client, novel_id, "arcs.md")
    return novel_id, doc["text"].split("## ")[0]


def test_a_regenerated_arc_book_inherits_the_bullets_the_model_omitted(client: TestClient) -> None:
    novel_id, header = _two_arc_novel(client)
    proposal = (
        header
        + "## 弧 1 卷一\n- **目标**：立起目标·改\n\n"
        + "## 弧 2 卷二\n- **目标**：追寻玄赿之门·改\n"
    )

    response = write(client, novel_id, "arcs.md", proposal, actor="ai")

    assert response.status_code == 200, response.text
    saved = read(client, novel_id, "arcs.md")["text"]
    assert saved.count("## 弧 ") == 2
    assert "## 弧 1 卷一" in saved and "## 弧 2 卷二" in saved
    # 省略不等于清空：这六个字段必须还是文件里原来那个值
    for label, value in (
        ("起始章", "10"), ("结束章", "60"), ("冲突", "追捕"),
        ("收束", "逃亡"), ("状态", "planned"),
    ):
        assert f"- **{label}**：{value}" in saved
    assert "- **目标**：立起目标·改" in saved


def test_an_appended_arc_no_longer_costs_the_existing_ones_their_inheritance(client: TestClient) -> None:
    # `_align_arc_history` 原先在弧块数≠现有数时整段放弃补齐，而 D-39 之后「重新生成 +
    # 追加一条」是合法形状：新那条一进来，连已有两条也一起报「缺少 起始章、结束章…」。
    novel_id, header = _two_arc_novel(client)
    proposal = (
        header
        + "## 弧 1 卷一\n- **目标**：立起目标·改\n\n"
        + "## 弧 2 卷二\n- **目标**：追寻玄赿之门·改\n\n"
        + "## 弧 ? 卷三\n- **起始章**：101\n- **结束章**：140\n- **目标**：门后\n"
    )

    response = write(client, novel_id, "arcs.md", proposal, actor="ai")

    assert response.status_code == 200, response.text
    saved = read(client, novel_id, "arcs.md")["text"]
    assert saved.count("## 弧 ") == 3
    # 已有两条：主键不动，省略掉的字段回到文件里原来的值
    assert "## 弧 1 卷一" in saved and "## 弧 2 卷二" in saved
    for label, value in (("起始章", "10"), ("结束章", "60"), ("冲突", "追捕"), ("收束", "逃亡")):
        assert f"- **{label}**：{value}" in saved
    # 新那条只有可选字段是系统给的默认值，主键由系统分配
    assert "## 弧 3 卷三" in saved
    assert saved.count("- **状态**：planned") == 3


def test_two_arcs_appended_in_one_proposal_do_not_land_on_the_same_key(client: TestClient) -> None:
    # 主人那条 B 层围栏自己改道出来的 C 层卡，实测就是死在这里：`弧 N` 是行的自增 id，
    # 全局计数，而 `_resolve_ids` 按「本书最大 id + 1」猜号。本书的 id 落后于全局时，
    # 猜出的号会撞上本次提案刚插入的那一行，第二条追加就被当成「改了受保护字段」拒掉。
    novel_id, header = _two_arc_novel(client)
    other = client.post("/api/novels", json={"title": "另一本书"}).json()["id"]
    create_arc(client, other, title="别书的弧", start_chapter=1, end_chapter=3, objective="占位")

    proposal = (
        header
        + "## 弧 1 卷一\n- **目标**：立起目标·改\n\n"
        + "## 弧 2 卷二\n- **目标**：追寻玄赿之门·改\n\n"
        + "## 弧 ? 卷三\n- **起始章**：101\n- **结束章**：140\n- **目标**：门后\n\n"
        + "## 弧 ? 卷四\n- **起始章**：141\n- **结束章**：180\n- **目标**：门后更深处\n"
    )

    response = write(client, novel_id, "arcs.md", proposal, actor="ai")

    assert response.status_code == 200, response.text
    saved = read(client, novel_id, "arcs.md")["text"]
    assert saved.count("## 弧 ") == 4
    assert "- **起始章**：101" in saved and "- **起始章**：141" in saved


def test_a_range_heading_in_the_b_layer_becomes_an_appliable_c_layer_card(client: TestClient) -> None:
    """35.2：范围标题属于 C 层，抽提案时改道成一张可应用的弧卡，B 层章号一寸不动。"""
    from app.services.chat import extract_proposals

    novel_id = seed_novel(client, "B 层范围标题")
    toc_live = read(client, novel_id, "toc.md")["text"]
    arcs_live = read(client, novel_id, "arcs.md")["text"]
    fence = (
        "# 目录（B 层 · 全书）\n\n"
        "## 第 42 章 星渊碑影\n- **剧情功能**：揭示碑的来历\n- **备注**：两\n行\n\n"
        "## 第 43 章 追捕\n- **剧情功能**：第一个冲突高潮\n- **备注**：清道夫\n\n"
        "## 第 44-60 章 弧 3：门钥之谜\n- **剧情功能**：追寻门钥\n- **备注**：结识更多觉醒者\n\n"
        "## 第 61-120 章 弧 9-13：永恒的相对\n- **剧情功能**：扩展\n- **备注**：开放式结局\n"
    )
    current = lambda path: {"toc.md": toc_live, "arcs.md": arcs_live}.get(path)  # noqa: E731

    cards = extract_proposals(f"```markdown @toc.md\n{fence}\n```", current)
    toc = next(c for c in cards if c["path"] == "toc.md")
    arcs = next((c for c in cards if c["path"] == "arcs.md"), None)

    assert arcs is not None, cards
    assert [c["valid"] for c in cards] == [True, True], cards
    assert "第 44-60 章" not in toc["text"] and "## 第 43 章 追捕" in toc["text"]
    assert "## 弧 ? 门钥之谜" in arcs["text"], arcs["text"]
    # 「弧 9-13：」这种跨号前缀也要整段去掉，剩下的才是标题
    assert "## 弧 ? 永恒的相对" in arcs["text"], arcs["text"]
    assert "- **起始章**：44" in arcs["text"] and "- **结束章**：120" in arcs["text"]

    for card in cards:
        applied = write(client, novel_id, card["path"], card["text"], actor="ai")
        assert applied.status_code == 200, applied.text
    assert "第 44-60 章" not in read(client, novel_id, "toc.md")["text"]
    assert sorted(int(n) for n in re.findall(r"^## 第 (\d+) 章", read(client, novel_id, "toc.md")["text"], re.M)) == [42, 43]

    # 第二轮就是主人实测踩到的那一步：同一条围栏重读，那两条弧已经在书上了。
    toc_after = read(client, novel_id, "toc.md")["text"]
    arcs_after = read(client, novel_id, "arcs.md")["text"]
    current_again = lambda path: {  # noqa: E731
        "toc.md": toc_after,
        "arcs.md": arcs_after,
    }.get(path)

    again = next(
        c for c in extract_proposals(f"```markdown @toc.md\n{fence}\n```", current_again)
        if c["path"] == "arcs.md"
    )

    assert again["text"] == arcs_after, again["text"]
    assert write(client, novel_id, "arcs.md", again["text"], actor="ai").status_code == 200
    assert read(client, novel_id, "arcs.md")["text"].count("## 弧 ") == arcs_after.count("## 弧 ")


def test_a_json_chapters_block_becomes_a_toc_card(client: TestClient) -> None:
    """35.27：主人要一份目录提案，模型把 `propose_toc` 的 payload 格式当正文吐了出来。

    ```json 围栏不匹配 PROPOSAL_BLOCK，所以从前是无卡、无报错、整份 JSON 静默消失。
    输入是主人作品 7 第 72 条回答里那份逐字形状（书上有第 42 章，追加只能往上加）。
    """
    from app.services.chat import extract_proposals

    novel_id = seed_novel(client, "JSON 目录")
    toc_live = read(client, novel_id, "toc.md")["text"]
    payload = """{
  "chapters": [
    {"number": 1, "title": "苏醒", "plot_function": "主角醒来，失去记忆，被追捕", "notes": "开篇悬念"},
    {"number": 2, "title": "追猎", "plot_function": "首次遭遇守碑人组织", "notes": "冲突引入"},
    {"number": 42, "title": "星渊碑影", "plot_function": "揭示碑的来历", "notes": "两行"}
  ]
}"""
    answer = f"我先给出目录：\n\n```json\n{payload}\n```\n\n要不要我继续扩展？"

    cards = extract_proposals(answer, lambda path: toc_live if path == "toc.md" else None)
    toc = next((c for c in cards if c["path"] == "toc.md"), None)
    assert toc is not None, cards
    assert toc["valid"] is True, toc["error"]
    assert "## 第 1 章 苏醒" in toc["text"] and "## 第 42 章 星渊碑影" in toc["text"]

    applied = write(client, novel_id, "toc.md", toc["text"], actor="ai")
    assert applied.status_code == 200, applied.text
    assert "## 第 2 章 追猎" in read(client, novel_id, "toc.md")["text"]


def test_a_json_block_that_is_not_a_toc_payload_stays_plain_code(client: TestClient) -> None:
    """认的是 `{"chapters": […]}` 这一个形状，别的 json 块一张卡都不许造。"""
    from app.services.chat import extract_proposals

    cards = extract_proposals('```json\n{"persons": [{"name": "沈曜"}]}\n```', lambda path: None)
    assert cards == []


def test_a_json_chapters_block_the_compiler_refuses_still_produces_no_card(client: TestClient) -> None:
    """编译器说「缺 title」就不许改口造一张坏卡出来——卡片这一侧只有合法与没有两种。"""
    from app.services.chat import extract_proposals

    novel_id = seed_novel(client, "JSON 目录缺字段")
    toc_live = read(client, novel_id, "toc.md")["text"]
    payload = (
        '{"chapters": ['
        '{"number": 42, "title": "星渊碑影", "plot_function": "揭示碑的来历", "notes": "两行"},'
        '{"number": 43, "plot_function": "没有标题", "notes": "z"}'
        "]}"
    )
    cards = extract_proposals(f"```json\n{payload}\n```", lambda path: toc_live if path == "toc.md" else None)
    assert cards == []


def test_dropping_an_arc_is_still_refused_after_the_inheritance_fix(client: TestClient) -> None:
    # 35.1 的修法只放开「继承不再整段放弃」这一件事，结构校验一寸没让：少一条＝删除。
    novel_id, header = _two_arc_novel(client)
    proposal = header + "## 弧 1 卷一\n- **目标**：立起目标·改\n"

    refused = write(client, novel_id, "arcs.md", proposal, actor="ai")

    assert refused.status_code == 422
    saved = read(client, novel_id, "arcs.md")["text"]
    assert saved.count("## 弧 ") == 2
    assert "## 弧 2 卷二" in saved


def test_a_short_arc_book_says_deletion_before_it_says_missing_fields(client: TestClient) -> None:
    """35.16：少列条目＝删除，红字必须先说这件事。

    作品 6 实测：C 层涨到 9 条弧之后，上一轮那条只列 3 条的围栏重读回来的是
    `「弧 1 觉醒·逃亡」 … 不可增删改名：缺少 起始章、结束章、冲突、收束、状态`。
    拒绝对，说的是另一件事——省略的 bullet 由 `_align_arc_history` 继承回来（D-43），
    少列那一条它绑不上就整段放弃，于是原始文本先撞结构校验，更准的那句永远读不到。
    """
    from app.services.documents import validate_structure

    novel_id = client.post("/api/novels", json={"title": "少列两条"}).json()["id"]
    for start, end, title in ((10, 60, "卷一"), (61, 100, "卷二"), (101, 140, "卷三")):
        create_arc(
            client, novel_id, title=title, start_chapter=start, end_chapter=end,
            objective="立起目标", conflict="追捕", resolution="逃亡",
        )
    live = read(client, novel_id, "arcs.md")["text"]
    header = live.split("## ")[0]
    two_of_three = (
        header
        + "## 弧 1 卷一\n- **目标**：立起目标·改\n\n"
        + "## 弧 2 卷二\n- **目标**：追寻玄赿之门·改\n"
    )

    dropped = validate_structure("arcs.md", two_of_three, current_text=live)
    assert dropped.startswith("不能删除条目或改动 arc 主键"), dropped

    all_three = two_of_three + "\n## 弧 3 卷三\n- **目标**：门后\n"
    short_on_fields = validate_structure("arcs.md", all_three, current_text=live)
    assert short_on_fields.startswith("「弧 1 卷一」 的小节标题与字段名是结构标识"), short_on_fields
    assert "缺少 起始章、结束章、冲突、收束、状态" in short_on_fields

    # 主人那条围栏的实际形状：号与档上完全不搭（书里是 7..13，它写 1、2），bullet 也省了。
    # 同一道闸门（D-39）的另一句——仍是结构判定，不是那张字段清单。
    renumbered = (
        header
        + "## 弧 7 卷一\n- **目标**：立起目标·改\n\n"
        + "## 弧 8 卷二\n- **目标**：追寻玄赿之门·改\n"
    )
    disjoint = validate_structure("arcs.md", renumbered, current_text=live)
    assert "不能自己点号" in disjoint, disjoint
    assert "缺少 起始章" not in disjoint, disjoint

    # 主人看到的是卡上那行字，不是函数返回值：同一份围栏走抽提案那条路。
    from app.services.chat import extract_proposals

    card = extract_proposals(f"```markdown @arcs.md\n{two_of_three}\n```", lambda p: live)[0]
    assert card["valid"] is False, card
    assert card["error"].startswith("不能删除条目或改动 arc 主键"), card["error"]


def test_an_applied_arc_fence_does_not_come_back_red_on_reload(client: TestClient) -> None:
    """35.1 判据末条「刷新后红字 0」：这张卡已经落库，重读就不该再挂一张红卡。

    落库后书比围栏多一条，`_align_arc_history` 原先在块数≠现有数时整段放弃，还原不出来了；
    前端 `baseText === text` 那条收卡规则因此永远不触发，红字随刷新回来。
    """
    from app.services.chat import extract_proposals

    novel_id, header = _two_arc_novel(client)
    fence = (
        header
        + "## 弧 1 卷一\n- **目标**：立起目标·改\n\n"
        + "## 弧 2 卷二\n- **目标**：追寻玄赿之门·改\n\n"
        + "## 弧 ? 卷三\n- **起始章**：101\n- **结束章**：140\n- **目标**：门后\n"
    )
    applied = write(client, novel_id, "arcs.md", fence, actor="ai")
    assert applied.status_code == 200, applied.text
    live = read(client, novel_id, "arcs.md")["text"]

    card = next(
        item
        for item in extract_proposals(f"```markdown @arcs.md\n{fence}\n```", lambda p: live)
        if item["path"] == "arcs.md"
    )

    assert card["valid"] is True, card
    # 与文件一字不差，正是前端据此把卡收起的那个条件
    assert card["text"] == live, card["text"]


def test_custom_blueprint_section_round_trips_through_the_file_writer(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.md")

    accepted = write(client, novel_id, "blueprint.md", doc["text"] + "## 我随手加的一节\n\n蓝图旁注\n")

    assert accepted.status_code == 200, accepted.text
    assert "custom_sections" in accepted.json()["changed"]
    refreshed = read(client, novel_id, "blueprint.md")["text"]
    assert "## 我随手加的一节\n蓝图旁注" in refreshed
    row = client.get(f"/api/novels/{novel_id}/planning/blueprints").json()[0]
    assert row["custom_sections"] == [{"label": "我随手加的一节", "content": "蓝图旁注"}]


def test_custom_brief_section_round_trips_and_is_allowed_in_ai_proposals(client: TestClient) -> None:
    novel_id = seed_novel(client)
    path = "chapters/0042/brief.md"
    doc = read(client, novel_id, path)
    text = doc["text"] + "## 场景色调\n冷蓝色，压低亮度。\n"

    human = write(client, novel_id, path, text)
    assert human.status_code == 200, human.text
    assert "场景色调" in read(client, novel_id, path)["text"]

    ai = write(client, novel_id, path, text.replace("压低亮度", "压低亮度，雨声不断"), actor="ai")
    assert ai.status_code == 200, ai.text
    refreshed = read(client, novel_id, path)["text"]
    assert "雨声不断" in refreshed


def test_custom_character_section_round_trips_and_renders(client: TestClient) -> None:
    from tests.planning_helpers import create_character

    novel_id = client.post("/api/novels", json={"title": "开放人物小节"}).json()["id"]
    person = create_character(client, novel_id, name="顾遥")
    path = f"settings/characters/{person['id']}.md"
    doc = read(client, novel_id, path)
    text = doc["text"] + "## 特殊能力\n能听见石头里的回声。\n"

    result = write(client, novel_id, path, text)
    assert result.status_code == 200, result.text
    assert "## 特殊能力\n能听见石头里的回声。" in read(client, novel_id, path)["text"]
    row = next(item for item in client.get(f"/api/novels/{novel_id}/characters").json() if item["id"] == person["id"])
    assert row["custom_sections"] == [{"label": "特殊能力", "content": "能听见石头里的回声。"}]


def test_custom_worldview_section_round_trips_inside_a_record(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "开放世界观小节"}).json()["id"]
    setting = create_setting(client, novel_id, name="潮汐历", category="制度", content="一年十三月")
    path = "settings/worldview.md"
    doc = read(client, novel_id, path)
    text = doc["text"].rstrip() + "\n### 历法例外\n每逢蓝月停摆。\n"

    result = write(client, novel_id, path, text)
    assert result.status_code == 200, result.text
    refreshed = read(client, novel_id, path)["text"]
    assert "### 历法例外\n每逢蓝月停摆。" in refreshed
    row = next(item for item in client.get(f"/api/novels/{novel_id}/settings").json() if item["id"] == setting["id"])
    assert row["custom_sections"] == [{"label": "历法例外", "content": "每逢蓝月停摆。"}]


def test_custom_record_sections_are_rendered_and_parsed_for_foreshadow() -> None:
    from app.services.markdown_doc import parse, render

    source = [{
        "foreshadow": 3,
        "title": "黑潮",
        "planted_chapter": 2,
        "expected_payoff_chapter": 9,
        "payoff_chapter": None,
        "status": "open",
        "content": "潮声先于风出现。",
        "custom_sections": [{"label": "回收提示", "content": "必须保留蓝月意象。"}],
    }]
    text = render("foreshadow", source)
    assert "### 回收提示\n必须保留蓝月意象。" in text
    assert parse("foreshadow", text) == source


def test_typed_agent_actions_accept_custom_sections() -> None:
    from app.services.proposal_actions import run_action

    ok, blueprint = run_action(
        "update_blueprint",
        {
            "main_line": "主线",
            "ending": "终局",
            "core_conflicts": "冲突",
            "themes": "主题",
            "constraints": "约束",
            "custom_sections": [{"label": "个人评价", "content": "值得继续扩展。"}],
        },
    )
    assert ok, blueprint
    assert "## 个人评价\n值得继续扩展。" in blueprint

    ok, brief = run_action(
        "upsert_chapter_brief",
        {
            "chapter_number": 3,
            "goal": "推进",
            "custom_sections": [{"label": "情绪曲线", "content": "由冷转热。"}],
        },
    )
    assert ok, brief
    assert "## 情绪曲线\n由冷转热。" in brief


def test_a_list_section_rejects_prose(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "chapters/0042/brief.md")

    accepted = write(
        client,
        novel_id,
        "chapters/0042/brief.md",
        doc["text"].replace("## 既定事实\n", "## 既定事实\n这是一段散文而不是条目\n"),
        actor="human",
    )
    assert accepted.status_code == 422
    assert "列表小节" in accepted.json()["detail"]


def test_stale_base_revision_conflicts(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.md")
    write(client, novel_id, "blueprint.md", doc["text"].replace("## 终局\n\n", "## 终局\n碑归碑\n\n", 1), actor="ai")

    stale = write(
        client,
        novel_id,
        "blueprint.md",
        doc["text"].replace("## 主题\n\n", "## 主题\n名字即存在\n\n", 1),
        actor="ai",
        base_revision=doc["revision"],
    )

    assert stale.status_code == 409


def test_writing_a_new_brief_file_creates_it(client: TestClient) -> None:
    novel_id = seed_novel(client)
    text = (
        "# 第 7 章简报（D 层 · 单章简报）\n"
        "\n"
        "> 文件名章号即主键。这一页是 `/generate` 的输入，也进对话上下文。「必要事实」按字面匹配校验，填能逐字找到的关键词，不填整句。\n"
        "\n"
        "- **章节号**：7\n"
        "- **所属弧**：—\n"
        "- **视角**：沈曜\n"
        "- **出场人物**：\n"
        "  - 沈曜\n"
        "- **状态**：draft\n"
        "\n"
        "## 目标\n"
        "主角入观星台\n"
        "\n"
        "## 事件\n"
        "\n"
        "## 冲突\n"
        "\n"
        "## 钩子\n"
        "\n"
        "## 既定事实\n"
    )

    created = write(client, novel_id, "briefs/0007.md", text)

    assert created.status_code == 200, created.text
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert {item["chapter_number"] for item in briefs} == {42, 7}
    assert "chapters/0007/brief.md" in [item["path"] for item in client.get(f"/api/novels/{novel_id}/files").json()]


def test_new_brief_append_creates_the_chapter_atomically(client: TestClient) -> None:
    novel_id = seed_novel(client, "原子追加")
    path = "chapters/0008/brief.md"
    doc = read(client, novel_id, path)

    created = write(client, novel_id, path, doc["text"])

    assert created.status_code == 200, created.text
    assert created.json()["path"] == path
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert next(item["chapter_number"] for item in briefs if item["chapter_number"] == 8) == 8
    chapters = client.get(f"/api/novels/{novel_id}/chapters").json()
    assert [chapter["chapter_number"] for chapter in chapters] == [8, 42]
    assert chapters[0]["brief_id"] == next(item["id"] for item in briefs if item["chapter_number"] == 8)


def test_draft_file_projects_and_writes_chapter_prose(client: TestClient) -> None:
    novel_id = seed_novel(client, "正文投影")
    doc = read(client, novel_id, "chapters/0042/draft.md")

    edited = doc["text"] + "沈曜推开了石门。\n\n## 场景\n碑门后是旧阶。\n"
    saved = write(client, novel_id, "chapters/0042/draft.md", edited)

    assert saved.status_code == 200, saved.text
    assert saved.json()["changed"] == ["content"]
    chapter = client.get(f"/api/novels/{novel_id}/chapters").json()[0]
    assert "沈曜推开了石门。" in chapter["content"]
    assert "## 场景\n碑门后是旧阶。" in chapter["content"]
    assert chapter["word_count"] == len(chapter["content"])
    projected = read(client, novel_id, "chapters/0042/draft.md")["text"]
    assert projected.startswith("# 第 42 章正文")
    assert projected.endswith("碑门后是旧阶。\n")


@pytest.mark.parametrize(
    "path",
    ["notes.txt", "briefs/0007.yml", "briefs/0007.yaml", "briefs/../novel.md", "%2e%2e/secrets.md"],
)
def test_unknown_paths_are_not_served(client: TestClient, path: str) -> None:
    novel_id = seed_novel(client)

    assert client.get(f"/api/novels/{novel_id}/files/{path}").status_code == 404


def test_documents_require_an_existing_novel(client: TestClient) -> None:
    assert client.get("/api/novels/999/files").status_code == 404
    assert client.get("/api/novels/999/files/toc.md").status_code == 404
