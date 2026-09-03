"""Repeatable S1 smoke: isolated DB, file-layer planning, context, draft.

Usage:
    .venv\\Scripts\\python.exe scripts\\writing_ring_smoke.py
    .venv\\Scripts\\python.exe scripts\\writing_ring_smoke.py --live

The default run never calls a model provider: it uses the deterministic draft
template so the writing ring can be verified without spending tokens. --live
uses backend/.env and requires NOVEL_LLM_DRAFT_MODEL to be configured.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine, select

from app.models import ChapterBrief, Novel
from app.services import documents
from app.services.chapters import generate_from_brief
from app.services.context import (
    build_writing_context,
    injection_report,
    parse_context_manifest,
)
from app.services.llm import (
    LLMSettings,
    OpenAICompatibleClient,
    get_llm_client,
)
from app.services.markdown_doc import render


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


BLUEPRINT = {
    "main_line": "沈曜追查星渊碑缺失的名字，揭开九曜门旧案。",
    "ending": "他拒绝成为新的执碑人，把名字还给凡人。",
    "core_conflicts": "凡人记忆与星官秩序争夺碑文的解释权。",
    "themes": "记忆、责任、不肯被天命收编的人。",
    "constraints": "禁止神明直接下场；能力代价必须可感知。",
}

TOC = [
    {
        "chapter": 1,
        "title": "雪夜碑鸣",
        "plot_function": "引入碑文异动与沈曜的执念。",
        "notes": "结尾留下守碑人脚印。",
    }
]

ARC = [
    {
        "arc": None,
        "title": "碑鸣初现",
        "start_chapter": 1,
        "end_chapter": 3,
        "objective": "确认碑文与旧案相关。",
        "conflict": "观星阁禁止私查碑名。",
        "resolution": "沈曜拿到第一块碑屑。",
        "status": "planned",
    }
]

BRIEF = {
    "chapter": 1,
    "arc": None,
    "goal": "让沈曜听见碑鸣，并决定违反禁令查看碑面。",
    "events": "雪夜巡阁；碑名短暂复现；守碑人脚印指向旧道。",
    "pov": "沈曜",
    "characters": ["沈曜", "老观主"],
    "conflict": "阁律禁止靠近碑面，但碑文主动呼唤他。",
    "hook": "脚印尽头有一枚还带体温的青铜碑屑。",
    "required_facts": ["青铜碑屑"],
    "status": "draft",
}


def _write_file(session: Session, novel_id: int, path: str, kind: str, payload: dict | list) -> None:
    chapter = payload.get("chapter") if isinstance(payload, dict) else None
    documents.write_file(
        session,
        novel_id,
        path,
        render(kind, payload, chapter=chapter),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the isolated minimal writing ring.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="call the configured OpenAI-compatible draft model (costs tokens)",
    )
    args = parser.parse_args()

    if args.live:
        llm = get_llm_client()
        if not llm.settings.is_configured:
            print("FAIL: --live 需要 backend/.env 里的 API key 与 draft 模型")
            return 2
        mode = f"live:{llm.settings.models.get('draft') or 'configured'}"
    else:
        settings = LLMSettings(
            provider="offline",
            api_base_url="",
            api_key=None,
            timeout=0,
            models={"draft": "", "review": "", "summary": "", "chat": ""},
        )
        llm = OpenAICompatibleClient(settings)
        mode = "offline-template"

    with tempfile.TemporaryDirectory(prefix="novel-writing-ring-") as temp_dir:
        engine = create_engine(
            f"sqlite:///{Path(temp_dir).joinpath('smoke.db').as_posix()}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(engine)

        with Session(engine) as session:
            novel = Novel(
                title="星渊碑鸣（S1 smoke）",
                description="隔离临时库中的最小写作环验证。",
                target_chapters=3,
                style_constraints="中文长篇；冷峻观星意象；短句收束。",
            )
            session.add(novel)
            session.commit()
            session.refresh(novel)

            _write_file(session, novel.id, documents.BLUEPRINT_PATH, "blueprint", BLUEPRINT)
            _write_file(session, novel.id, documents.TOC_PATH, "toc", TOC)
            _write_file(session, novel.id, documents.ARCS_PATH, "arcs", ARC)
            _write_file(
                session,
                novel.id,
                documents.brief_path(1),
                "brief",
                BRIEF,
            )

            brief = session.exec(
                select(ChapterBrief).where(
                    ChapterBrief.novel_id == novel.id,
                    ChapterBrief.chapter_number == 1,
                )
            ).one()

            context = build_writing_context(session, novel.id, 1, brief_id=brief.id)
            print("=== S1 最小写作环 ===")
            print(f"mode={mode}")
            print(
                injection_report(
                    context,
                    novel_id=novel.id,
                    chapter_number=1,
                    note="S1 smoke 预演",
                )
            )

            result = generate_from_brief(session, llm, novel, brief)
            chapter = result["chapter"]
            run = result["generation_run"]
            manifest = parse_context_manifest(run.input_summary)

            ok = bool(chapter.content.strip()) and manifest is not None and context.used > 0

        engine.dispose()

        print("=== 结果 ===")
        print(
            f"chapter_id={chapter.id} words={chapter.word_count} "
            f"model={run.model} tokens={run.token_input}/{run.token_output}"
        )
        print(f"machine_check={'PASS' if result['machine_check']['passed'] else 'FAIL'}")
        print(f"manifest_blocks={len(manifest['blocks']) if manifest else 0}")
        print("draft_head=" + chapter.content[:160].replace("\n", " "))
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
