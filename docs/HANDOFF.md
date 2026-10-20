# 开发与检查入口

## 启动

```powershell
cd E:\novel-generator\backend
python -m alembic upgrade head
python -m uvicorn app.main:app --port 8000

cd E:\novel-generator\frontend
npm run dev
```

前端默认 `http://127.0.0.1:5173/`，后端默认 `http://127.0.0.1:8000/`。先检查端口，避免旧进程掩盖当前代码。后端 `.env` 指向独立新库 `novel_generator_v2.db`，不得改回旧库做重建验收。

## Codex 平台 MCP

`tools/novel_platform_mcp/server.py` 提供 15 个工具，覆盖服务状态、作品与工作区读取、OpenAPI 按需发现、统一命令预览/执行/撤销、现有 API 读写、固定质量门禁、真实 Edge 截图、DOM 测量及白名单点击/输入/滚动/滚轮/有界拖拽。`audit_platform_ui` 会在同一会话逐动作返回几何与滚动时间线并保存截图，适合复现交互偏差；不开放任意页面脚本。

开发验收分两条通道：MCP 的无头 Edge 用于可重复测量和截图；需要主人现场观看时，使用 Codex 内置浏览器的可见标签页。两者都只验证页面，产品内 Agent 仍通过后端函数而不是模拟鼠标操作平台。

配置变更只会被新开的 Codex 会话加载；当前会话可用 `E:\Anaconda\python.exe tools\novel_platform_mcp\smoke_test.py` 验证 stdio，并用 `client.py <tool> --arguments '<json>'` 通过真实 MCP 协议调用工具。危险或结构性通用 API 写入必须显式传 `confirmed=true`，不得用它绕过统一命令目录的迁移工作。

## 验证

```powershell
cd E:\novel-generator\backend
python -m pytest

cd E:\novel-generator\frontend
npm test -- --run
npx tsc -b --force --pretty false
npm run build
```

最新实际汇总见 `WORKSTREAM-PLAN.md`；测试、HTTP 可达、构建成功和真实浏览器验收必须分别报告，不能把固定条数当成长期真源。

## 接手顺序

1. 读 `PRD.md`、`ARCHITECTURE.md`、`WORKSTREAM-PLAN.md`。
2. 在 `UI-BACKLOG.md` 选择一项，只读目标目录的 `description.md` 与当前 `backlog.md`。
3. 先补失败验收，再精准实现；页面、Agent 和 Workflow 的写入必须进入统一命令目录。
4. 完成后更新目标目录 `backlog.md` 与实时进度，删除已完成的 UI 待办。

## 归档边界

文件归档位于 `.scratch/rebuild-archive-2026-10-18/`，旧库 SHA-256 为 `9001A2AE9E54663A856FF362D3D9B69A37B9C0B985664F0BFA84563013F6DC27`。归档分支与 Tag 尚因 `.git` 写权限受限而未创建。
