"""Codex-facing control plane for the local novel workbench.

The product UI is deliberately not involved.  Every data mutation still goes
through the running FastAPI application, so this MCP observes the same
validation, transactions and audit records as a human using the page.
"""

from __future__ import annotations

import os
import base64
import json
import shutil
import socket
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote, urljoin, urlsplit

import httpx
import websocket
from fastmcp import FastMCP
from fastmcp.utilities.types import Image


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
SCRATCH = ROOT / ".scratch" / "platform-mcp"
DEFAULT_API_URL = "http://127.0.0.1:8000"
DEFAULT_UI_URL = "http://127.0.0.1:5173"


class PlatformGateway:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("NOVEL_PLATFORM_API", DEFAULT_API_URL)).rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | list[Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float = 60.0,
    ) -> Any:
        url = urljoin(f"{self.base_url}/", path.lstrip("/"))
        try:
            # The platform is loopback-only. Inheriting the user's proxy can both
            # break localhost (for example socks5h on older httpx) and leak a local
            # route to an unrelated proxy, so this client deliberately ignores it.
            with httpx.Client(trust_env=False, timeout=timeout) as client:
                response = client.request(method, url, json=body, params=params)
        except httpx.HTTPError as cause:
            raise RuntimeError(f"Platform API is unavailable: {cause}") from cause
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except ValueError:
                detail = response.text
            raise RuntimeError(f"Platform API {response.status_code}: {detail}")
        if response.status_code == 204 or not response.content:
            return None
        return response.json()


gateway = PlatformGateway()
mcp = FastMCP(
    "novel-platform",
    version="1.0.0",
    instructions=(
        "Operate and verify the local novel workbench through backend APIs. "
        "Prefer unified commands; use generic API tools for capabilities not yet migrated. "
        "Preview destructive changes and ask the owner before passing confirmed=true."
    ),
)


def _success(summary: str, artifacts: Any, next_actions: list[str] | None = None) -> dict[str, Any]:
    return {
        "status": "success",
        "summary": summary,
        "next_actions": next_actions or [],
        "artifacts": artifacts,
    }


def _api_path(path: str) -> str:
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/api/"):
        raise ValueError("path must be a local /api/... path")
    return path


def _compact_record(record: dict[str, Any], include_content: bool) -> dict[str, Any]:
    compact = dict(record)
    if not include_content and isinstance(compact.get("content"), str):
        compact["content_chars"] = len(compact["content"])
        compact.pop("content", None)
    return compact


def _probe(url: str) -> bool:
    try:
        with httpx.Client(trust_env=False, timeout=2.0) as client:
            return client.get(url).status_code < 500
    except httpx.HTTPError:
        return False


@mcp.tool
def platform_status() -> dict[str, Any]:
    """Check backend and frontend reachability without changing platform state."""
    backend_ok = _probe(f"{gateway.base_url}/api/health")
    ui_url = os.getenv("NOVEL_PLATFORM_UI", DEFAULT_UI_URL).rstrip("/")
    frontend_ok = _probe(ui_url)
    return _success(
        "平台服务已检查",
        {"backend": backend_ok, "frontend": frontend_ok, "api_url": gateway.base_url, "ui_url": ui_url},
        [] if backend_ok and frontend_ok else ["Call ensure_platform_services"],
    )


@mcp.tool
def list_novels(include_archived: bool = False) -> dict[str, Any]:
    """List novels with compact metadata; omits large document bodies."""
    novels = gateway.request("GET", "/api/novels")
    if not include_archived:
        novels = [item for item in novels if not item.get("archived", False)]
    return _success(f"读取到 {len(novels)} 部作品", {"novels": novels})


@mcp.tool
def get_workspace(novel_id: int, include_content: bool = False) -> dict[str, Any]:
    """Read one rebuilt workspace. Content bodies are omitted by default to save tokens."""
    workspace = gateway.request("GET", f"/api/novels/{novel_id}/workspace")
    for key in ("documents", "knowledge"):
        workspace[key] = [_compact_record(item, include_content) for item in workspace.get(key, [])]
    return _success(
        f"已读取作品 {novel_id} 的工作区",
        {"workspace": workspace},
        ["Set include_content=true only when exact text is required"],
    )


@mcp.tool
def search_platform_api(query: str = "", method: str = "", limit: int = 30) -> dict[str, Any]:
    """Search OpenAPI operations by path, summary, tag or method without loading the full schema."""
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    schema = gateway.request("GET", "/openapi.json")
    needle = query.strip().lower()
    wanted_method = method.strip().lower()
    found: list[dict[str, Any]] = []
    for path, operations in schema.get("paths", {}).items():
        if not path.startswith("/api/"):
            continue
        for verb, operation in operations.items():
            if verb.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            if wanted_method and verb.lower() != wanted_method:
                continue
            haystack = " ".join(
                [path, verb, str(operation.get("summary", "")), " ".join(operation.get("tags", []))]
            ).lower()
            if needle and needle not in haystack:
                continue
            found.append(
                {
                    "method": verb.upper(),
                    "path": path,
                    "summary": operation.get("summary", ""),
                    "operation_id": operation.get("operationId", ""),
                    "tags": operation.get("tags", []),
                    "has_request_body": "requestBody" in operation,
                }
            )
            if len(found) >= limit:
                break
        if len(found) >= limit:
            break
    return _success(f"找到 {len(found)} 个 API 操作", {"operations": found})


@mcp.tool
def preview_platform_command(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a unified command and return its real diff without writing."""
    preview = gateway.request("POST", f"/api/commands/{name}/preview", body={"payload": payload})
    return _success(f"已预览 {name}", {"preview": preview})


@mcp.tool
def execute_platform_command(
    name: str,
    payload: dict[str, Any],
    idempotency_key: str,
    approved: bool = False,
) -> dict[str, Any]:
    """Execute one canonical platform command. High-risk commands require approved=true after preview."""
    operation = gateway.request(
        "POST",
        f"/api/commands/{name}/execute",
        body={
            "payload": payload,
            "idempotency_key": idempotency_key,
            "actor": "codex-mcp",
            "approved": approved,
        },
    )
    return _success(f"已执行 {name}", {"operation": operation}, ["Use undo_platform_operation if needed"])


@mcp.tool
def undo_platform_operation(operation_id: int) -> dict[str, Any]:
    """Undo a reversible operation through the audited backend endpoint."""
    result = gateway.request("POST", f"/api/operations/{operation_id}/undo", params={"actor": "codex-mcp"})
    return _success(f"已撤销操作 {operation_id}", {"operation": result})


@mcp.tool
def platform_read_api(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call any local GET /api endpoint. Use search_platform_api to discover routes."""
    result = gateway.request("GET", _api_path(path), params=params)
    return _success(f"GET {path} 完成", {"response": result})


@mcp.tool
def platform_write_api(
    method: Literal["POST", "PUT", "PATCH", "DELETE"],
    path: str,
    body: dict[str, Any] | list[Any] | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    """Call an existing local write endpoint. DELETE/restore/reorder/import require confirmed=true."""
    safe_path = _api_path(path)
    high_risk = method == "DELETE" or any(
        marker in safe_path.lower() for marker in ("/restore", "/import", "/densify", "/make-room", "/publish")
    )
    if high_risk and not confirmed:
        raise ValueError("This route is destructive or structural; inspect it first and pass confirmed=true")
    result = gateway.request(method, safe_path, body=body)
    return _success(f"{method} {safe_path} 完成", {"response": result})


def _start_process(command: list[str], cwd: Path, log_name: str) -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    log_path = SCRATCH / log_name
    log = log_path.open("ab")
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            # The MCP server is a short-lived stdio child. Without a detached process
            # group Windows tears the dev servers down as soon as that MCP call exits,
            # even though the health probe just reported them ready.
            creationflags=(
                getattr(subprocess, "CREATE_NO_WINDOW", 0)
                | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                | getattr(subprocess, "DETACHED_PROCESS", 0)
            ),
            close_fds=True,
        )
    finally:
        log.close()
    return process.pid


@mcp.tool
def ensure_platform_services(wait_seconds: int = 20) -> dict[str, Any]:
    """Start the known backend/frontend development services when they are not already reachable."""
    if not 1 <= wait_seconds <= 60:
        raise ValueError("wait_seconds must be between 1 and 60")
    started: dict[str, int] = {}
    backend_url = f"{gateway.base_url}/api/health"
    ui_url = os.getenv("NOVEL_PLATFORM_UI", DEFAULT_UI_URL).rstrip("/")
    if not _probe(backend_url):
        started["backend"] = _start_process(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
            BACKEND,
            "backend.log",
        )
    if not _probe(ui_url):
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm:
            raise RuntimeError("npm was not found")
        started["frontend"] = _start_process(
            [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
            FRONTEND,
            "frontend.log",
        )
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if _probe(backend_url) and _probe(ui_url):
            break
        time.sleep(0.25)
    status = {"backend": _probe(backend_url), "frontend": _probe(ui_url), "started_pids": started}
    if not status["backend"] or not status["frontend"]:
        status["logs"] = str(SCRATCH)
        return {"status": "error", "summary": "服务未在等待时间内就绪", "next_actions": ["Inspect MCP logs"], "artifacts": status}
    return _success("平台服务已就绪", status)


CHECKS: dict[str, list[tuple[str, list[str], Path]]] = {
    "mcp": [("mcp", [sys.executable, "-m", "pytest", "tests/test_platform_mcp.py", "-q"], BACKEND)],
    "backend": [("backend", [sys.executable, "-m", "pytest", "-q"], BACKEND)],
    "frontend": [("frontend", ["npm.cmd", "test", "--", "--run"], FRONTEND)],
    "typecheck": [("typecheck", ["npx.cmd", "tsc", "-b", "--force"], FRONTEND)],
    "build": [("build", ["npm.cmd", "run", "build"], FRONTEND)],
}
CHECKS["all"] = CHECKS["backend"] + CHECKS["frontend"] + CHECKS["typecheck"] + CHECKS["build"]


@mcp.tool
def run_platform_checks(
    gate: Literal["mcp", "backend", "frontend", "typecheck", "build", "all"],
    timeout_seconds: int = 900,
) -> dict[str, Any]:
    """Run a fixed project quality gate. No arbitrary command or shell text is accepted."""
    if gate not in CHECKS:
        raise ValueError(f"Unknown gate: {gate}")
    if not 10 <= timeout_seconds <= 1800:
        raise ValueError("timeout_seconds must be between 10 and 1800")
    results: list[dict[str, Any]] = []
    for name, raw_command, cwd in CHECKS[gate]:
        command = list(raw_command)
        if command[0].endswith(".cmd"):
            resolved = shutil.which(command[0])
            if not resolved:
                raise RuntimeError(f"{command[0]} was not found")
            command[0] = resolved
        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                cwd=cwd,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            stderr = exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            return {
                "status": "error",
                "summary": f"质量门禁 {name} 超时",
                "next_actions": ["Read output_tail and locate the last running test"],
                "artifacts": {
                    "results": results
                    + [
                        {
                            "gate": name,
                            "exit_code": None,
                            "seconds": round(time.monotonic() - started, 2),
                            "output_tail": (stdout + stderr).strip()[-12000:],
                        }
                    ]
                },
            }
        output = (completed.stdout + completed.stderr).strip()
        results.append(
            {
                "gate": name,
                "exit_code": completed.returncode,
                "seconds": round(time.monotonic() - started, 2),
                "output_tail": output[-12000:],
            }
        )
        if completed.returncode != 0:
            return {
                "status": "error",
                "summary": f"质量门禁 {name} 未通过",
                "next_actions": ["Read output_tail and fix the first failure"],
                "artifacts": {"results": results},
            }
    return _success(f"质量门禁 {gate} 已通过", {"results": results})


def _edge_path() -> Path:
    candidates = [
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("Microsoft Edge was not found")


def _local_route(route: str) -> str:
    parsed = urlsplit(route)
    if parsed.scheme or parsed.netloc or not route.startswith("/"):
        raise ValueError("route must be a local path beginning with /")
    return route


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _cdp_call(connection: websocket.WebSocket, request_id: int, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    connection.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(connection.recv())
        if message.get("id") == request_id:
            if "error" in message:
                raise RuntimeError(f"CDP {method} failed: {message['error']}")
            return message.get("result", {})


@contextmanager
def _browser_session(route: str, width: int, height: int, wait_ms: int):
    _local_route(route)
    if not 320 <= width <= 3840 or not 320 <= height <= 2160:
        raise ValueError("viewport is outside the supported range")
    if not 0 <= wait_ms <= 15000:
        raise ValueError("wait_ms must be between 0 and 15000")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex[:8]
    profile = SCRATCH / f"edge-profile-{run_id}"
    port = _free_port()
    process = subprocess.Popen(
        [
            str(_edge_path()),
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            f"--user-data-dir={profile}",
            f"--window-size={width},{height}",
            "about:blank",
        ],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    endpoint = f"http://127.0.0.1:{port}"
    connection: websocket.WebSocket | None = None
    try:
        deadline = time.monotonic() + 15
        with httpx.Client(trust_env=False, timeout=2) as client:
            while time.monotonic() < deadline:
                try:
                    if client.get(f"{endpoint}/json/version").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Edge debugging endpoint did not start")
            ui_url = os.getenv("NOVEL_PLATFORM_UI", DEFAULT_UI_URL).rstrip("/")
            tab = client.put(f"{endpoint}/json/new?{quote(ui_url + route, safe=':/?=&')}").json()
        connection = websocket.create_connection(
            tab["webSocketDebuggerUrl"],
            timeout=15,
            suppress_origin=True,
            http_proxy_host=None,
        )
        _cdp_call(connection, 1, "Runtime.enable")
        _cdp_call(connection, 2, "Page.enable")
        _cdp_call(
            connection,
            3,
            "Emulation.setDeviceMetricsOverride",
            {
                "width": width,
                "height": height,
                "deviceScaleFactor": 1,
                "mobile": False,
                "screenWidth": width,
                "screenHeight": height,
            },
        )
        time.sleep(wait_ms / 1000)
        yield connection
    finally:
        if connection is not None:
            connection.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def _evaluate(connection: websocket.WebSocket, request_id: int, expression: str) -> Any:
    result = _cdp_call(
        connection,
        request_id,
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True, "awaitPromise": True},
    )
    if result.get("exceptionDetails"):
        raise RuntimeError("Browser interaction failed")
    return result.get("result", {}).get("value")


def _validated_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(actions) > 20:
        raise ValueError("at most 20 browser actions are allowed")
    validated: list[dict[str, Any]] = []
    for raw in actions:
        action = str(raw.get("action", ""))
        selector = str(raw.get("selector", "")).strip()
        if action not in {"click", "right_click", "input", "scroll", "wheel", "hover", "drag", "reload", "navigate"}:
            raise ValueError(f"Unsupported browser action: {action}")
        if action == "navigate":
            route = str(raw.get("route", "")).strip()
            _local_route(route)
            validated.append({"action": action, "route": route})
            continue
        if not selector or len(selector) > 300:
            raise ValueError("every browser action needs a short CSS selector")
        item: dict[str, Any] = {"action": action, "selector": selector}
        if action == "click" and ("ratio_x" in raw or "ratio_y" in raw):
            for name, value in (("ratio_x", raw.get("ratio_x", 0.5)), ("ratio_y", raw.get("ratio_y", 0.5))):
                if not isinstance(value, int | float) or isinstance(value, bool) or not 0 <= value <= 1:
                    raise ValueError(f"{name} must be between 0 and 1")
                item[name] = float(value)
        if action == "input":
            value = raw.get("value", "")
            if not isinstance(value, str) or len(value) > 10000:
                raise ValueError("input value must be a string no longer than 10000 characters")
            item["value"] = value
        if action == "scroll":
            ratio = raw.get("ratio", 0)
            if not isinstance(ratio, int | float) or isinstance(ratio, bool) or not 0 <= ratio <= 1:
                raise ValueError("scroll ratio must be between 0 and 1")
            item["ratio"] = float(ratio)
        if action == "wheel":
            delta_y = raw.get("delta_y", 0)
            if not isinstance(delta_y, int | float) or isinstance(delta_y, bool) or not -2000 <= delta_y <= 2000:
                raise ValueError("wheel delta_y must be between -2000 and 2000")
            if delta_y == 0:
                raise ValueError("wheel needs a non-zero delta_y")
            item["delta_y"] = float(delta_y)
        if action == "drag":
            delta_x = raw.get("delta_x", 0)
            delta_y = raw.get("delta_y", 0)
            for name, value in (("delta_x", delta_x), ("delta_y", delta_y)):
                if not isinstance(value, int | float) or isinstance(value, bool) or not -2000 <= value <= 2000:
                    raise ValueError(f"{name} must be between -2000 and 2000")
            if delta_x == 0 and delta_y == 0:
                raise ValueError("drag needs a non-zero delta")
            item["delta_x"] = float(delta_x)
            item["delta_y"] = float(delta_y)
            # A return endpoint keeps the same pointer pressed while it crosses a
            # close threshold and comes back. This is still a bounded mouse gesture,
            # not an arbitrary browser script.
            if "return_delta_x" in raw or "return_delta_y" in raw:
                return_x = raw.get("return_delta_x", delta_x)
                return_y = raw.get("return_delta_y", delta_y)
                for name, value in (("return_delta_x", return_x), ("return_delta_y", return_y)):
                    if not isinstance(value, int | float) or isinstance(value, bool) or not -2000 <= value <= 2000:
                        raise ValueError(f"{name} must be between -2000 and 2000")
                item["return_delta_x"] = float(return_x)
                item["return_delta_y"] = float(return_y)
        validated.append(item)
    return validated


def _measurement_expression(selectors: list[str]) -> str:
    encoded = json.dumps(selectors, ensure_ascii=False)
    return f"""(() => {{
      const selectors = {encoded};
      return {{
        url: location.href,
        title: document.title,
        viewport: {{ width: innerWidth, height: innerHeight, devicePixelRatio }},
        uiZoom: getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim(),
        lastPointer: window.__novelPlatformLastPointer || null,
        selectors: selectors.map((selector) => {{
          const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 20);
          return {{ selector, count: document.querySelectorAll(selector).length, nodes: nodes.map((node) => {{
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {{
              text: (node.textContent || '').trim().slice(0, 300),
              rect: {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }},
              scroll: {{ top: node.scrollTop, height: node.scrollHeight, clientHeight: node.clientHeight, width: node.scrollWidth, clientWidth: node.clientWidth }},
              style: {{ fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, overflowY: style.overflowY, color: style.color, backgroundColor: style.backgroundColor, opacity: style.opacity, visibility: style.visibility, zoom: style.zoom }}
            }};
          }}) }};
        }})
      }};
    }})()"""


def _run_ui_actions(connection: websocket.WebSocket, actions: list[dict[str, Any]], request_id: int = 20) -> int:
    for action in actions:
        if action["action"] == "navigate":
            ui_url = os.getenv("NOVEL_PLATFORM_UI", DEFAULT_UI_URL).rstrip("/")
            _cdp_call(connection, request_id, "Page.navigate", {"url": ui_url + action["route"]})
            request_id += 1
            time.sleep(1.0)
            continue
        encoded_selector = json.dumps(action["selector"], ensure_ascii=False)
        if action["action"] == "right_click":
            point = _evaluate(
                connection,
                request_id,
                f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); const rect = node.getBoundingClientRect(); return {{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }}; }})()""",
            )
            request_id += 1
            for event_type, buttons in (("mousePressed", 2), ("mouseReleased", 0)):
                _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": event_type, "x": point["x"], "y": point["y"], "button": "right", "buttons": buttons, "clickCount": 1})
                request_id += 1
            time.sleep(0.25)
            continue
        if action["action"] == "click" and "ratio_y" in action:
            point = _evaluate(
                connection,
                request_id,
                f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); const rect = node.getBoundingClientRect(); return {{ x: rect.left + rect.width * {action['ratio_x']}, y: rect.top + rect.height * {action['ratio_y']} }}; }})()""",
            )
            request_id += 1
            for event_type, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
                _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": event_type, "x": point["x"], "y": point["y"], "button": "left", "buttons": buttons, "clickCount": 1})
                request_id += 1
            time.sleep(0.25)
            continue
        if action["action"] == "click":
            expression = f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); node.click(); return true; }})()"""
        elif action["action"] == "input":
            _evaluate(
                connection,
                request_id,
                f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); node.focus(); if (typeof node.select === 'function') node.select(); return true; }})()""",
            )
            request_id += 1
            _cdp_call(connection, request_id, "Input.insertText", {"text": action["value"]})
            request_id += 1
            time.sleep(0.25)
            continue
        elif action["action"] == "scroll":
            ratio = action["ratio"]
            expression = f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); node.scrollTop = (node.scrollHeight - node.clientHeight) * {ratio}; node.dispatchEvent(new Event('scroll', {{ bubbles: true }})); return true; }})()"""
        elif action["action"] in {"wheel", "hover"}:
            point = _evaluate(
                connection,
                request_id,
                f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); const rect = node.getBoundingClientRect(); return {{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }}; }})()""",
            )
            request_id += 1
            _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mouseMoved", "x": point["x"], "y": point["y"]})
            request_id += 1
            if action["action"] == "hover":
                time.sleep(0.25)
                continue
            _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mouseWheel", "x": point["x"], "y": point["y"], "deltaX": 0, "deltaY": action["delta_y"]})
            request_id += 1
            time.sleep(0.25)
            continue
        elif action["action"] == "reload":
            _cdp_call(connection, request_id, "Page.reload", {"ignoreCache": True})
            request_id += 1
            time.sleep(1.0)
            continue
        else:
            point = _evaluate(
                connection,
                request_id,
                f"""(() => {{ const node = document.querySelector({encoded_selector}); if (!node) throw new Error('selector not found'); const rect = node.getBoundingClientRect(); return {{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }}; }})()""",
            )
            request_id += 1
            start_x = float(point["x"])
            start_y = float(point["y"])
            _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mouseMoved", "x": start_x, "y": start_y})
            request_id += 1
            _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mousePressed", "x": start_x, "y": start_y, "button": "left", "buttons": 1, "clickCount": 1})
            request_id += 1
            for step in range(1, 7):
                x = start_x + action["delta_x"] * step / 6
                y = start_y + action["delta_y"] * step / 6
                _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "left", "buttons": 1})
                request_id += 1
            end_x = action.get("return_delta_x", action["delta_x"])
            end_y = action.get("return_delta_y", action["delta_y"])
            if "return_delta_x" in action:
                for step in range(1, 7):
                    x = start_x + action["delta_x"] + (end_x - action["delta_x"]) * step / 6
                    y = start_y + action["delta_y"] + (end_y - action["delta_y"]) * step / 6
                    _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "left", "buttons": 1})
                    request_id += 1
            _cdp_call(connection, request_id, "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": start_x + end_x, "y": start_y + end_y, "button": "left", "buttons": 0, "clickCount": 1})
            request_id += 1
            time.sleep(0.25)
            continue
        _evaluate(connection, request_id, expression)
        request_id += 1
        time.sleep(0.25)
    return request_id


@mcp.tool
def inspect_platform_ui(
    route: str,
    selectors: list[str],
    width: int = 1440,
    height: int = 900,
    wait_ms: int = 1500,
) -> dict[str, Any]:
    """Measure text, geometry, scroll state and computed styles for selected elements in a real Edge page."""
    if not selectors or len(selectors) > 20 or any(not item or len(item) > 300 for item in selectors):
        raise ValueError("selectors must contain between 1 and 20 short CSS selectors")
    with _browser_session(route, width, height, wait_ms) as connection:
        measurements = _evaluate(connection, 10, _measurement_expression(selectors))
    return _success("真实页面测量完成", {"measurements": measurements})


@mcp.tool
def interact_platform_ui(
    route: str,
    actions: list[dict[str, Any]],
    width: int = 1440,
    height: int = 900,
    wait_ms: int = 1500,
) -> Image:
    """Run allowlisted click/input/scroll/drag actions in real Edge and return the resulting screenshot."""
    validated = _validated_actions(actions)
    SCRATCH.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = SCRATCH / f"interaction-{stamp}-{uuid.uuid4().hex[:8]}.png"
    with _browser_session(route, width, height, wait_ms) as connection:
        request_id = _run_ui_actions(connection, validated)
        shot = _cdp_call(connection, request_id, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
        output.write_bytes(base64.b64decode(shot["data"]))
    return Image(path=output)


@mcp.tool
def audit_platform_ui(
    route: str,
    actions: list[dict[str, Any]],
    selectors: list[str],
    width: int = 1440,
    height: int = 900,
    wait_ms: int = 1500,
) -> dict[str, Any]:
    """Run allowlisted interactions, then return same-page geometry plus a screenshot path."""
    validated = _validated_actions(actions)
    if not selectors or len(selectors) > 20 or any(not item or len(item) > 300 for item in selectors):
        raise ValueError("selectors must contain between 1 and 20 short CSS selectors")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = SCRATCH / f"audit-{stamp}-{uuid.uuid4().hex[:8]}.png"
    with _browser_session(route, width, height, wait_ms) as connection:
        _evaluate(
            connection,
            15,
            "window.addEventListener('pointerdown', event => { window.__novelPlatformLastPointer = { clientX: event.clientX, clientY: event.clientY }; }, true); true",
        )
        request_id = 20
        timeline: list[dict[str, Any]] = []
        for action in validated:
            request_id = _run_ui_actions(connection, [action], request_id)
            measurements = _evaluate(connection, request_id, _measurement_expression(selectors))
            request_id += 1
            timeline.append({"action": action, "measurements": measurements})
        measurements = timeline[-1]["measurements"] if timeline else _evaluate(
            connection, request_id, _measurement_expression(selectors)
        )
        if not timeline:
            request_id += 1
        shot = _cdp_call(connection, request_id, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
        output.write_bytes(base64.b64decode(shot["data"]))
    return _success(
        "真实页面交互、测量与截图在同一会话完成",
        {"measurements": measurements, "timeline": timeline, "screenshot_path": str(output.resolve())},
    )


@mcp.tool
def capture_platform_ui(route: str = "/", width: int = 1440, height: int = 900, wait_ms: int = 3000) -> Image:
    """Render a real local page in headless Edge and return the screenshot as MCP image content."""
    _local_route(route)
    if not 320 <= width <= 3840 or not 320 <= height <= 2160:
        raise ValueError("viewport is outside the supported range")
    if not 0 <= wait_ms <= 15000:
        raise ValueError("wait_ms must be between 0 and 15000")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = uuid.uuid4().hex[:8]
    output = SCRATCH / f"ui-{stamp}-{run_id}.png"
    profile = SCRATCH / f"edge-profile-{run_id}"
    ui_url = os.getenv("NOVEL_PLATFORM_UI", DEFAULT_UI_URL).rstrip("/")
    url = f"{ui_url}{route}"
    command = [
        str(_edge_path()),
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--user-data-dir={profile}",
        f"--window-size={width},{height}",
        f"--virtual-time-budget={wait_ms}",
        f"--screenshot={output}",
        url,
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        timeout=max(30, wait_ms // 1000 + 20),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode != 0 or not output.is_file():
        detail = (completed.stderr or completed.stdout).decode("utf-8", errors="replace")[-1200:]
        raise RuntimeError(f"Edge could not capture the local page: {detail}")
    return Image(path=output)


if __name__ == "__main__":
    mcp.run()
