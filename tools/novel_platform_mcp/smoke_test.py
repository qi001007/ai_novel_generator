"""Run a real stdio handshake against the local MCP entrypoint."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from fastmcp import Client


SERVER = Path(__file__).with_name("server.py")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


async def main() -> None:
    async with Client(SERVER) as client:
        if len(sys.argv) > 1:
            arguments = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
            result = await client.call_tool(sys.argv[1], arguments)
            print(json.dumps(result.data, ensure_ascii=False, default=str))
            return
        tools = await client.list_tools()
        names = sorted(tool.name for tool in tools)
        print(f"TOOLS {len(names)} {','.join(names)}")


if __name__ == "__main__":
    asyncio.run(main())
