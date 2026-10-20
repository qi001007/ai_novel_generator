"""Bounded local Python runner for pure JSON workflow nodes.

This is a trusted-local worker boundary, not a security sandbox. Cloud execution must
replace it with a container or micro-VM adapter without changing the workflow contract.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import tempfile
from typing import Any


class PythonNodeError(RuntimeError):
    pass


_BLOCKED_CALLS = {
    "breakpoint",
    "compile",
    "delattr",
    "eval",
    "exec",
    "getattr",
    "globals",
    "input",
    "locals",
    "open",
    "setattr",
    "vars",
    "__import__",
}


def _validate(code: str) -> None:
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise PythonNodeError(f"Python syntax error: {exc.msg}") from exc
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.AsyncFunctionDef, ast.With, ast.AsyncWith)):
            raise PythonNodeError(f"Unsupported Python construct: {type(node).__name__}")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _BLOCKED_CALLS:
            raise PythonNodeError(f"Blocked Python function: {node.func.id}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise PythonNodeError("Private and dunder attributes are blocked")
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main"]
    if len(functions) != 1:
        raise PythonNodeError("Python node must define exactly one main(inputs) function")


_RUNNER = r"""
import json, sys
payload = json.loads(sys.stdin.read())
safe = {
    'abs': abs, 'all': all, 'any': any, 'bool': bool, 'dict': dict,
    'enumerate': enumerate, 'filter': filter, 'float': float, 'int': int,
    'len': len, 'list': list, 'map': map, 'max': max, 'min': min,
    'range': range, 'reversed': reversed, 'round': round, 'set': set,
    'sorted': sorted, 'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip,
}
namespace = {'__builtins__': safe}
exec(payload['code'], namespace, namespace)
result = namespace['main'](payload['inputs'])
sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
"""


def run_python_node(
    code: str,
    inputs: dict[str, Any],
    *,
    timeout_seconds: float = 5.0,
    max_output_bytes: int = 1_000_000,
) -> Any:
    _validate(code)
    executable = os.getenv("NOVEL_WORKFLOW_PYTHON", sys.executable)
    payload = json.dumps({"code": code, "inputs": inputs}, ensure_ascii=False)
    try:
        with tempfile.TemporaryDirectory(prefix="novel-workflow-") as workdir:
            completed = subprocess.run(
                [executable, "-I", "-c", _RUNNER],
                input=payload,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                cwd=workdir,
                timeout=timeout_seconds,
                check=False,
            )
    except subprocess.TimeoutExpired as exc:
        raise PythonNodeError(f"Python node timed out after {timeout_seconds:g}s") from exc
    if completed.returncode != 0:
        message = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "worker crashed"
        raise PythonNodeError(f"Python node failed: {message}")
    encoded = completed.stdout.encode("utf-8")
    if len(encoded) > max_output_bytes:
        raise PythonNodeError("Python node output exceeded the configured size limit")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise PythonNodeError("Python node returned invalid JSON") from exc
