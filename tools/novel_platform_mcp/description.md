# novel_platform_mcp

为 Codex 提供小说工作台的低 Token 结构化控制面。

- `server.py`：stdio MCP；调用本地 API、固定质量门禁、服务启动、页面测量、受控交互与截图。
- `install.ps1`：幂等写入 Codex MCP 配置（需用户级目录写权限）。
- `smoke_test.py`：启动真实子进程并验证 stdio 握手与工具发现；可传工具名和 JSON 参数做单次真实调用。

红线：不直接访问数据库，不执行任意命令，不允许访问本机平台之外的 URL。
