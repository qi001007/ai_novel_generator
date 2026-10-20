"""Invoke one novel-platform tool through a real FastMCP stdio session."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import sys
from typing import Any

from fastmcp import Client


SERVER = Path(__file__).with_name("server.py")

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("tool")
    parser.add_argument("--arguments", default="{}")
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--keep-alive",
        action="store_true",
        help="keep the stdio MCP parent alive after the call (used by local dev services)",
    )
    return parser


def _print_result(result: Any, output: Path | None) -> None:
    if result.structured_content is not None:
        print(json.dumps(result.structured_content, ensure_ascii=False, indent=2))

    for item in result.content:
        if item.type == "text" and result.structured_content is None:
            print(item.text)
        elif item.type == "image":
            if output is None:
                raise ValueError("--output is required for image results")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(base64.b64decode(item.data))
            print(str(output.resolve()))


async def _invoke(
    tool: str,
    arguments: dict[str, Any],
    output: Path | None,
    keep_alive: bool,
) -> None:
    async with Client(SERVER) as client:
        result = await client.call_tool(tool, arguments)
        _print_result(result, output)
        if keep_alive:
            print("MCP_KEEP_ALIVE", flush=True)
            await asyncio.Event().wait()


def main() -> None:
    args = _parser().parse_args()
    arguments = json.loads(args.arguments)
    if not isinstance(arguments, dict):
        raise ValueError("--arguments must decode to a JSON object")
    asyncio.run(_invoke(args.tool, arguments, args.output, args.keep_alive))


if __name__ == "__main__":
    main()
