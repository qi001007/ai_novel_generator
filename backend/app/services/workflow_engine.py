"""Execute an immutable WorkflowVersion and persist every node transition."""

from __future__ import annotations

import json
from collections import deque
from typing import Any

from sqlmodel import Session, select

from app.models import NodeRun, WorkflowRun, WorkflowVersion, utc_now
from app.services.context_planner import build_context_preview
from app.services.llm import RoutedLLMClient, resolve_routing


def _topological(graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = {node["id"]: node for node in graph["nodes"]}
    incoming = {node_id: 0 for node_id in nodes}
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for edge in graph["edges"]:
        incoming[edge["target"]] += 1
        outgoing[edge["source"]].append(edge["target"])
    ready = deque(sorted(node_id for node_id, count in incoming.items() if count == 0))
    ordered: list[dict[str, Any]] = []
    while ready:
        node_id = ready.popleft()
        ordered.append(nodes[node_id])
        for target in sorted(outgoing[node_id]):
            incoming[target] -= 1
            if incoming[target] == 0:
                ready.append(target)
    if len(ordered) != len(nodes):
        raise RuntimeError("Workflow graph is cyclic")
    return ordered


def _read_path(value: Any, path: str) -> Any:
    current = value
    for part in path.split(".") if path else []:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            current = current[int(part)]
        else:
            return None
    return current


def _resolve(value: Any, *, run_input: dict[str, Any], outputs: dict[str, Any]) -> Any:
    if isinstance(value, str) and value.startswith("$input."):
        return _read_path(run_input, value[7:])
    if isinstance(value, str) and value.startswith("$node."):
        node_id, _, path = value[6:].partition(".")
        return _read_path(outputs.get(node_id), path)
    if isinstance(value, list):
        return [_resolve(item, run_input=run_input, outputs=outputs) for item in value]
    if isinstance(value, dict):
        return {key: _resolve(item, run_input=run_input, outputs=outputs) for key, item in value.items()}
    return value


def _json_value(text: str) -> Any:
    raw = text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip().startswith("```") else lines[1:])
    return json.loads(raw)


def _review_payload(value: Any) -> Any:
    """Unwrap the node-input envelope before reading issues/updates."""
    for _ in range(5):
        if isinstance(value, str):
            value = _json_value(value)
            continue
        if isinstance(value, dict) and "text" in value:
            value = _json_value(str(value["text"]))
            continue
        if isinstance(value, dict) and len(value) == 1 and not (
            {"issues", "setting_updates", "suggestions"} & set(value)
        ):
            value = next(iter(value.values()))
            continue
        break
    return value


def _review_issues(value: Any) -> list[dict[str, str]]:
    if isinstance(value, str):
        value = _json_value(value)
    if isinstance(value, dict) and "text" in value:
        value = _json_value(str(value["text"]))
    if isinstance(value, dict):
        value = value.get("issues", value.get("suggestions"))
    if not isinstance(value, list):
        raise RuntimeError("Review workflow output must be a JSON issue list")
    issues: list[dict[str, str]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise RuntimeError(f"Review issue {index + 1} must be an object")
        normalized = {
            "category": str(item.get("category") or "其他"),
            "severity": str(item.get("severity") or "medium"),
            "location": str(item.get("location") or ""),
            "quote": str(item.get("quote") or item.get("original") or ""),
            "suggestion": str(item.get("suggestion") or item.get("replacement") or ""),
            "reason": str(item.get("reason") or item.get("comment") or ""),
        }
        if not normalized["quote"]:
            raise RuntimeError(f"Review issue {index + 1} has no source quote")
        issues.append(normalized)
    return issues


def _review_setting_updates(value: Any) -> list[dict[str, Any]]:
    """Optional drafts the reviewer wants added to the setting library."""
    if isinstance(value, str):
        value = _json_value(value)
    if isinstance(value, dict) and "text" in value:
        value = _json_value(str(value["text"]))
    if not isinstance(value, dict):
        return []
    raw = value.get("setting_updates")
    if not isinstance(raw, list):
        return []
    allowed = {"character", "worldview", "foreshadow", "setting"}
    updates: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip().lower()
        name = str(item.get("name") or "").strip()
        content = str(item.get("content") or "").strip()
        if kind not in allowed or not name or not content:
            continue
        updates.append({
            "kind": kind,
            "name": name,
            "content": content,
            "conflict": bool(item.get("conflict")),
            "conflict_with": str(item.get("conflict_with") or "").strip(),
        })
    return updates


def _node_input(node_id: str, graph: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    parents = [edge["source"] for edge in graph["edges"] if edge["target"] == node_id]
    return {parent: outputs[parent] for parent in parents if parent in outputs}


def _active(node_id: str, graph: dict[str, Any], outputs: dict[str, Any]) -> bool:
    incoming = [edge for edge in graph["edges"] if edge["target"] == node_id]
    if not incoming:
        return True
    for edge in incoming:
        if edge["source"] not in outputs:
            continue
        handle = edge.get("source_handle", "")
        parent = outputs[edge["source"]]
        if not handle or not isinstance(parent, dict) or parent.get("branch") == handle:
            return True
    return False


def _condition_matches(value: Any, operator: str, expected: Any) -> bool:
    if operator == "equals":
        return value == expected
    if operator == "not_equals":
        return value != expected
    if operator == "contains":
        return expected in value if isinstance(value, (str, list, tuple, set, dict)) else False
    if operator == "not_contains":
        return expected not in value if isinstance(value, (str, list, tuple, set, dict)) else True
    if operator == "is_empty":
        return value in (None, "", [], {}, ())
    if operator == "is_not_empty":
        return value not in (None, "", [], {}, ())
    if operator == "greater_than":
        return value > expected
    if operator == "less_than":
        return value < expected
    raise RuntimeError(f"Unsupported condition operator: {operator}")


def _execute_node(
    session: Session,
    run: WorkflowRun,
    node: dict[str, Any],
    graph: dict[str, Any],
    outputs: dict[str, Any],
) -> Any:
    node_type = node["type"]
    config = node.get("config") or {}
    inputs = _node_input(node["id"], graph, outputs)
    if node_type == "start":
        return run.input
    if node_type == "context":
        if run.novel_id is None:
            raise RuntimeError("Context nodes require a novel")
        policy = dict(config["policy"])
        context = build_context_preview(
            session,
            novel_id=run.novel_id,
            task_type="review" if run.input.get("workflow_purpose") == "review" else "generate",
            token_budget=max(100, int(config.get("token_budget") or int(policy.get("budget", 60000)) // 4)),
            outline_node_id=run.input.get("outline_node_id"),
            query=str(run.input.get("query", "")),
            policy=policy,
            chapter_number=int(run.input.get("chapter_number") or 1),
        )
        return {
            **context,
            "input": run.input,
            "token_input": int(context.get("estimated_tokens", 0)),
            "token_output": 0,
        }
    if node_type == "prompt":
        template = str(config.get("template", "{{input}}"))
        return {"text": template.replace("{{input}}", json.dumps(inputs, ensure_ascii=False))}
    if node_type == "condition":
        for branch in config["branches"]:
            value = _resolve(branch.get("value", "$input.value"), run_input=run.input, outputs=outputs)
            expected = _resolve(branch.get("expected"), run_input=run.input, outputs=outputs)
            if _condition_matches(value, str(branch["operator"]), expected):
                return {"branch": str(branch["id"]), "value": value}
        return {"branch": "else"}
    if node_type == "model":
        if "mock_output" in config:
            return {"text": str(config["mock_output"]), "token_input": 0, "token_output": 0}
        prompt_input = inputs.get("text") if isinstance(inputs, dict) else None
        if prompt_input is None and isinstance(inputs, dict) and len(inputs) == 1:
            upstream = next(iter(inputs.values()))
            if isinstance(upstream, dict):
                prompt_input = upstream.get("text")
        user_prompt = prompt_input if isinstance(prompt_input, str) else json.dumps(inputs, ensure_ascii=False)
        client = RoutedLLMClient(resolve_routing(session))
        system = str(config.get("system", "你是小说写作工作流中的正文生成节点。"))
        if config.get("output_schema") == "review_issues" or run.input.get("workflow_purpose") == "review":
            system += (
                '\n只检查本次目标章节，不改写正文。严格输出 JSON 对象：'
                '{"issues": [{"category": "类别", "severity": "medium", "location": "位置", '
                '"quote": "正文中唯一且逐字存在的片段", "suggestion": "可直接替换的正文", "reason": "原因"}], '
                '"setting_updates": [{"kind": "character|worldview|foreshadow", "name": "名称", '
                '"content": "应补进设定库的完整内容", "conflict": false, "conflict_with": "冲突对象"}]}。'
                '正文出现新人物、新世界规则或新伏笔时必须给出 setting_updates；'
                '与既有设定冲突时 conflict=true 并在 conflict_with 写明冲突点；没有则给空数组。'
                'suggestion 必须是可直接替换正文的成句，禁止写“建议改为…例如…”这类说明。'
                '不要输出 Markdown 或其它解释。'
            )
        result = client.complete_messages_on(
            str(config["provider_id"]),
            str(config.get("task_type") or ("review" if run.input.get("workflow_purpose") == "review" else "draft")),
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            model=str(config["model_id"]),
            temperature=float(config["temperature"]) if "temperature" in config else None,
            max_output_tokens=int(config["max_output_tokens"]) if "max_output_tokens" in config else None,
        )
        return {
            "text": result.content,
            "model": result.model,
            "token_input": result.token_input,
            "token_output": result.token_output,
        }
    if node_type == "output":
        resolved = _resolve(config.get("value", inputs), run_input=run.input, outputs=outputs)
        if config.get("format") == "review_issues":
            payload = _review_payload(resolved)
            return {
                "issues": _review_issues(payload),
                "setting_updates": _review_setting_updates(payload),
            }
        return resolved
    raise RuntimeError(f"Unsupported workflow node type: {node_type}")


def execute_workflow(session: Session, run: WorkflowRun) -> WorkflowRun:
    version = session.get(WorkflowVersion, run.workflow_version_id)
    if version is None:
        raise RuntimeError("Workflow version not found")
    graph = version.graph
    existing = session.exec(select(NodeRun).where(NodeRun.workflow_run_id == run.id)).all()
    by_node = {item.node_id: item for item in existing}
    outputs = {item.node_id: item.output for item in existing if item.status == "completed"}
    run.status = "running"
    run.started_at = run.started_at or utc_now()
    session.add(run)
    session.commit()

    try:
        for node in _topological(graph):
            node_id = node["id"]
            if node_id in outputs or not _active(node_id, graph, outputs):
                continue
            record = by_node.get(node_id) or NodeRun(
                workflow_run_id=run.id,
                node_id=node_id,
                node_type=node["type"],
            )
            record.status = "running"
            record.input = _node_input(node_id, graph, outputs)
            record.started_at = utc_now()
            session.add(record)
            session.commit()
            result = _execute_node(session, run, node, graph, outputs)
            record.output = result if isinstance(result, dict) else {"value": result}
            record.status = "completed"
            record.ended_at = utc_now()
            if node["type"] == "model":
                record.token_input = int(record.output.get("token_input", 0))
                record.token_output = int(record.output.get("token_output", 0))
            elif node["type"] == "context":
                # Context tokens are an estimate of what this node selected. They
                # are shown on the node but not added to the run total: the model's
                # reported input already contains the same text.
                record.token_input = int(record.output.get("token_input", 0))
                record.token_output = 0
            session.add(record)
            session.commit()
            outputs[node_id] = record.output

        output_nodes = [node["id"] for node in graph["nodes"] if node["type"] == "output"]
        final_ids = output_nodes or [node["id"] for node in graph["nodes"] if not any(edge["source"] == node["id"] for edge in graph["edges"])]
        run.output = {node_id: outputs.get(node_id, {}) for node_id in final_ids}
        node_runs = session.exec(select(NodeRun).where(NodeRun.workflow_run_id == run.id)).all()
        run.token_input = sum(item.token_input for item in node_runs if item.node_type == "model")
        run.token_output = sum(item.token_output for item in node_runs if item.node_type == "model")
        run.status = "completed"
        run.ended_at = utc_now()
        run.paused_node_id = ""
        session.add(run)
        session.commit()
        session.refresh(run)
        return run
    except Exception as exc:
        session.rollback()
        failed = session.exec(
            select(NodeRun).where(NodeRun.workflow_run_id == run.id, NodeRun.status == "running")
        ).first()
        if failed is not None:
            failed.status = "failed"
            failed.error = str(exc)
            failed.ended_at = utc_now()
            session.add(failed)
        run = session.get(WorkflowRun, run.id)
        run.status = "failed"
        run.error = str(exc)
        run.ended_at = utc_now()
        session.add(run)
        session.commit()
        return run
