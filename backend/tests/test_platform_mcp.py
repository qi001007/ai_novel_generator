from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from fastmcp import Client


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.novel_platform_mcp import server  # noqa: E402


@pytest.mark.anyio
async def test_mcp_exposes_the_complete_control_surface() -> None:
    async with Client(server.mcp) as client:
        tools = {tool.name for tool in await client.list_tools()}

    assert {
        "platform_status",
        "list_novels",
        "get_workspace",
        "search_platform_api",
        "preview_platform_command",
        "execute_platform_command",
        "undo_platform_operation",
        "platform_read_api",
        "platform_write_api",
        "ensure_platform_services",
        "run_platform_checks",
        "capture_platform_ui",
        "inspect_platform_ui",
        "interact_platform_ui",
        "audit_platform_ui",
    } <= tools


def test_workspace_summary_omits_large_content_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        server.gateway,
        "request",
        lambda method, path, **kwargs: {
            "novel": {"id": 7, "title": "低 Token 测试"},
            "outline": [{"id": 2, "title": "第一章"}],
            "documents": [{"id": 3, "path": "chapters/2/draft.md", "content": "正文" * 1000}],
            "knowledge": [{"id": 4, "kind": "character", "name": "沈砚", "content": "资料" * 1000}],
            "facts": [],
        },
    )

    result = server.get_workspace(7)

    assert result["status"] == "success"
    document = result["artifacts"]["workspace"]["documents"][0]
    knowledge = result["artifacts"]["workspace"]["knowledge"][0]
    assert "content" not in document
    assert document["content_chars"] == 2000
    assert "content" not in knowledge
    assert knowledge["content_chars"] == 2000


def test_generic_write_requires_explicit_confirmation_for_destructive_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    def request(*args, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(server.gateway, "request", request)

    with pytest.raises(ValueError, match="confirmed=true"):
        server.platform_write_api("DELETE", "/api/novels/7")
    assert called is False


def test_api_tools_refuse_non_local_and_non_api_paths() -> None:
    with pytest.raises(ValueError, match="/api/"):
        server.platform_read_api("https://example.com/private")
    with pytest.raises(ValueError, match="/api/"):
        server.platform_write_api("POST", "/openapi.json", {})


def test_quality_gate_has_no_arbitrary_shell_escape() -> None:
    with pytest.raises(ValueError, match="Unknown gate"):
        server.run_platform_checks("rm -rf anything")

    source = Path(server.__file__).read_text(encoding="utf-8")
    assert "stdin=subprocess.DEVNULL" in source
    assert "except subprocess.TimeoutExpired as exc:" in source


def test_windows_service_processes_are_detached_from_the_stdio_mcp() -> None:
    if sys.platform != "win32":
        pytest.skip("Windows process lifetime regression")
    expected = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    source = Path(server.__file__).read_text(encoding="utf-8")
    assert 'getattr(subprocess, "DETACHED_PROCESS", 0)' in source
    assert 'getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)' in source
    assert expected


def test_browser_actions_are_a_small_allowlist() -> None:
    assert server._validated_actions(
        [
            {"action": "click", "selector": "button.primary"},
            {"action": "right_click", "selector": ".workflow-resource"},
            {"action": "click", "selector": ".minimap", "ratio_y": 0.75},
            {"action": "input", "selector": "input[aria-label='搜索作品']", "value": "回声"},
            {"action": "scroll", "selector": ".cm-scroller", "ratio": 0.5},
            {"action": "wheel", "selector": ".cm-scroller", "delta_y": 600},
            {"action": "hover", "selector": ".minimap"},
            {"action": "drag", "selector": ".splitter[data-pane='sidebar']", "delta_x": 80, "delta_y": 0},
            {"action": "reload", "selector": "html"},
        ]
    )[4]["ratio"] == 0.5
    assert server._validated_actions(
        [{"action": "drag", "selector": ".splitter", "delta_x": -120, "delta_y": 0}]
    )[0]["delta_x"] == -120.0
    returning = server._validated_actions(
        [{
            "action": "drag",
            "selector": ".splitter",
            "delta_x": -400,
            "delta_y": 0,
            "return_delta_x": -40,
            "return_delta_y": 0,
        }]
    )[0]
    assert returning["return_delta_x"] == -40.0
    with pytest.raises(ValueError, match="non-zero delta"):
        server._validated_actions([{"action": "drag", "selector": ".splitter", "delta_x": 0, "delta_y": 0}])
    with pytest.raises(ValueError, match="return_delta_x"):
        server._validated_actions([
            {"action": "drag", "selector": ".splitter", "delta_x": 10, "return_delta_x": 3000}
        ])
    with pytest.raises(ValueError, match="ratio_y"):
        server._validated_actions([{"action": "click", "selector": ".minimap", "ratio_y": 2}])
    with pytest.raises(ValueError, match="non-zero"):
        server._validated_actions([{"action": "wheel", "selector": ".cm-scroller", "delta_y": 0}])
    with pytest.raises(ValueError, match="Unsupported browser action"):
        server._validated_actions([{"action": "evaluate", "selector": "body", "value": "alert(1)"}])


def test_browser_actions_allow_only_local_navigation() -> None:
    assert server._validated_actions([{"action": "navigate", "route": "/novels/5"}]) == [
        {"action": "navigate", "route": "/novels/5"}
    ]
    with pytest.raises(ValueError, match="local path"):
        server._validated_actions([{"action": "navigate", "route": "https://example.com"}])


def test_ui_audit_measurement_keeps_selectors_data_only() -> None:
    expression = server._measurement_expression([".minimap", ".cm-scroller"])

    assert 'const selectors = [".minimap", ".cm-scroller"]' in expression
    assert "getBoundingClientRect" in expression
    assert "scrollHeight" in expression
    assert "opacity: style.opacity" in expression


def test_browser_input_uses_real_cdp_text_events() -> None:
    source = Path(server.__file__).read_text(encoding="utf-8")

    assert '"Input.insertText"' in source
    assert "node.value =" not in source


def test_browser_session_overrides_the_css_viewport_exactly() -> None:
    source = Path(server.__file__).read_text(encoding="utf-8")

    assert '"Emulation.setDeviceMetricsOverride"' in source
    assert '"deviceScaleFactor": 1' in source
