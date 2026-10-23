"""Generate durable candidates from the active immutable workflow, without writing prose."""

import re

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import Chapter, GenerationJob, WorkflowRun, WorkflowVersion
from app.services.documents import read_file
from app.services.workflow_engine import execute_workflow
from app.services.workflows import active_workflow


def _document_text(session: Session, novel_id: int, path: str) -> str:
    try:
        return read_file(session, novel_id, path).text
    except Exception:
        return ""


def _section_text(text: str, heading: str) -> str:
    match = re.search(
        rf"(?ms)^##\s*{re.escape(heading)}\s*$\n(.*?)(?=^##\s|\Z)",
        text,
    )
    return match.group(1).strip() if match else ""


def _arc_covers(text: str, chapter_number: int) -> bool:
    for block in re.split(r"(?m)^##\s*弧\s", text)[1:]:
        start = re.search(r"(?m)^-\s*\*\*起始章\*\*\s*[：:]\s*(\d+)", block)
        end = re.search(r"(?m)^-\s*\*\*结束章\*\*\s*[：:]\s*(\d+)", block)
        if start and end and int(start.group(1)) <= chapter_number <= int(end.group(1)):
            return True
    return False


def generation_blockers(session: Session, chapter: Chapter) -> list[str]:
    """What the writer must fill before a model is allowed to write this chapter."""
    number = chapter.chapter_number
    blockers: list[str] = []

    blueprint = _document_text(session, chapter.novel_id, "blueprint.md")
    if not _section_text(blueprint, "主线"):
        blockers.append("A 层：先填《全书蓝图》的「主线」")

    toc = _document_text(session, chapter.novel_id, "toc.md")
    if not re.search(rf"(?m)^##\s*第\s*{number}\s*章", toc):
        blockers.append(f"B 层：目录里先有第 {number} 章")

    arcs = _document_text(session, chapter.novel_id, "arcs.md")
    if not _arc_covers(arcs, number):
        blockers.append(f"C 层：先让一条剧情弧覆盖第 {number} 章")

    brief = _document_text(session, chapter.novel_id, f"chapters/{number:04d}/brief.md")
    if not _section_text(brief, "目标") or not _section_text(brief, "事件"):
        blockers.append(f"D 层：第 {number} 章简报的「目标」「事件」要写实")

    if number > 1:
        previous = session.exec(
            select(Chapter).where(
                Chapter.novel_id == chapter.novel_id,
                Chapter.chapter_number == number - 1,
            )
        ).first()
        if previous is None or not previous.content.strip():
            blockers.append(f"上一章：第 {number - 1} 章正文还没有落稿")

    return blockers


def generate_candidate(session: Session, chapter: Chapter, request: str) -> GenerationJob:
    blockers = generation_blockers(session, chapter)
    if blockers:
        raise HTTPException(
            status_code=409,
            detail="生成前先补齐上下文：" + "；".join(blockers),
        )
    workflow = active_workflow(session, chapter.novel_id, "generation")
    if workflow is None:
        raise HTTPException(status_code=409, detail="请先在 Workflow 中设置当前正文生成流程")
    version = session.exec(select(WorkflowVersion).where(
        WorkflowVersion.workflow_id == workflow.id, WorkflowVersion.purpose == "generation",
    ).order_by(WorkflowVersion.version.desc())).first()
    if version is None:
        raise HTTPException(status_code=409, detail="当前正文生成流程尚未发布，请先保存并发布 Workflow")
    path = f"chapters/{chapter.chapter_number:04d}/draft.md"
    current = read_file(session, chapter.novel_id, path)
    run = WorkflowRun(
        novel_id=chapter.novel_id, workflow_id=workflow.id, workflow_version_id=version.id,
        input={"workflow_purpose": "generation", "chapter_id": chapter.id,
               "chapter_number": chapter.chapter_number, "request": request,
               "query": request or f"生成第 {chapter.chapter_number} 章正文"},
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    job = GenerationJob(novel_id=chapter.novel_id, kind="draft", status="running", payload={
        "chapter_id": chapter.id, "path": path, "base_revision": current.revision,
        "request": request, "workflow_version_id": version.id,
    }, result={"workflow_run_id": run.id})
    session.add(job)
    session.commit()
    session.refresh(job)
    run = execute_workflow(session, run)
    content = ""
    if run.status == "completed":
        # Output nodes normalize scalars to {value: ...}; the starter graph
        # forwards the model under its node id. Follow graph output only.
        values = list(run.output.values())
        while len(values) == 1 and isinstance(values[0], dict):
            value = values[0]
            if isinstance(value.get("text"), str):
                content = value["text"]
                break
            values = list(value.values())
        if len(values) == 1 and isinstance(values[0], str):
            content = values[0]
    # markdown_doc.parse() strips edges on read-back, so keep the stored candidate
    # canonical too - otherwise a model ending in "\n" can never be accepted.
    content = content.strip()
    output_node = next(
        (node for node in version.graph.get("nodes", []) if node.get("type") == "output"),
        None,
    )
    output_config = (output_node or {}).get("config") or {}
    minimum = int(output_config.get("min_chars") or 0)
    maximum = int(output_config.get("max_chars") or 0)
    length = len(content.strip())
    job.status = "completed" if content.strip() else "failed"
    job.error = "" if content.strip() else (run.error or "Workflow 未输出正文，请检查输出节点的连接与配置")
    if content.strip() and minimum and length < minimum:
        job.status = "failed"
        job.error = f"候选只有 {length} 字，低于输出节点要求的至少 {minimum} 字"
    elif content.strip() and maximum and length > maximum:
        job.status = "failed"
        job.error = f"候选有 {length} 字，超过输出节点允许的最多 {maximum} 字"
    job.result = {**job.result, "content": content,
                  "token_input": run.token_input, "token_output": run.token_output}
    session.add(job)
    session.commit()
    session.refresh(job)
    return job
