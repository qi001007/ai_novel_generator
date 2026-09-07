"""投影自带语法表的接线（候选 4b）。

不依赖任何 fixture：这三条各钉一个"少写一处就静默失效"的点。
"""
from app.routers import documents as documents_router
from app.services import documents, markdown_doc

WORLDVIEW = ["类别", "已确认", "来源章", "现况", "内容"]


def test_every_renderable_kind_has_a_grammar():
    for kind in ["blueprint", "toc", "arcs", "brief", "foreshadow", "worldview", "character"]:
        grammar = markdown_doc.grammar_for_kind(kind)
        assert grammar, f"{kind} 发不出表，前端就只能继续自带一份"
    assert markdown_doc.grammar_for_kind("chapter") == {}, "正文没有键行，不该有表"


def test_labels_are_not_a_second_copy():
    """表里的每一对都必须来自 codec 自己的元组。"""
    source = {
        (f, l)
        for value in vars(markdown_doc).values()
        if isinstance(value, tuple)
        for f, l in value
        if isinstance(f, str) and isinstance(l, str)
    }
    for kind in ["blueprint", "toc", "arcs", "brief", "foreshadow", "worldview", "character"]:
        for rows in markdown_doc.grammar_for_kind(kind).values():
            for row in rows:
                assert (row["field"], row["label"]) in source, (kind, row)


def test_read_file_attaches_the_table_and_the_response_model_keeps_it():
    doc = documents.FileDoc("settings/worldview.md", "worldview", "设定", "世界观", "", (), "r0")
    assert doc.grammar == {}, "默认不带：只有 with_grammar 才填"
    assert [r["label"] for r in doc.with_grammar().grammar["bullets"]] == WORLDVIEW
    # from_attributes 只会序列化响应模型声明过的字段：少声明一个就静默丢掉整张表
    assert "grammar" in documents_router.FileDocOut.model_fields
