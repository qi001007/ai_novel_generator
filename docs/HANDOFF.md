# 开发与检查入口

## 2026-10-23 接续状态（交给下一位接手者）

- 代码状态：本轮工作树改动已作为一次快照提交并推送到 `origin/main`；部署基线随该提交前移。上一快照 `c01f812` 仅代表 2026-10-21 的部署基线。
- 本轮实测门禁：后端 `510 passed`（仍排除缺 `fastmcp` 的 `test_platform_mcp.py`）；前端 36 文件 / 423 passed；`tsc -b --force` 退出 0；生产构建退出 0（主包 1.18 MB，Vite 仍提示超过 500 kB）；文档门禁 7 passed。
- 本轮已收口：C 层滑动窗口真实消费 `arc_window`（D-24）；生成→接受→自检→终审整链回归与旧 revision 409；修复测试库 `StaticPool` 单连接导致的 SSE 工具轨迹偶发丢失；免费通道与掩码回读取证。
- 仍未完成（详见 `UI-BACKLOG.md` V-22/V-23）：隔离库 + `mock_output` 的零费用 HTTP 真跑；拖动分栏时 localStorage 每帧写入的合并；生图标准 `sk-` 密钥与真实出图（V-08）。
- 硬边界：不碰正式库 `backend/novel_generator_v2.db` 与运行中的 8000/5173；任何付费模型/生图先列模型、次数、预估费用并等主人批准；密钥只由主人填写，回显只能是掩码。

## 本机部署（2026-10-21）

源码位于 `D:\AI_novel_generator`，部署基线为 `c01f812`。前端采用开发服务器，支持热更新；后端使用项目独立虚拟环境。新库为 `backend/novel_generator_v2.db`，不含历史作品；模型密钥需在应用设置中配置。

重启时在两个 PowerShell 终端分别运行：

```powershell
cd D:\AI_novel_generator\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
```

```powershell
cd D:\AI_novel_generator\frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

访问 `http://127.0.0.1:5173`；初次后台启动日志位于 `.scratch/`，后端当前运行于持续终端会话。数据库已执行 `alembic upgrade head`；部署时网页、代理健康检查及空作品列表接口均通过 HTTP 验证。最新验证结果见 `WORKSTREAM-PLAN.md`；测试限制见 `UI-BACKLOG.md` 的本机部署记录。

本机原 Token Plan 配置保留；主人已选择改用百炼标准 API。新增标准供应商及当前填写进度见 `WORKSTREAM-PLAN.md` S-03，官方用途边界和验收计划见 `UI-BACKLOG.md` S-03。密钥只在设置中填写，不写入文档；测试连接只验证模型目录接口，不等同于实际生成验收。

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

隔离整链证据库为 `.scratch/workflow-e2e-20261021.db`：采用本地假模型 HTTP 接口，已完成候选、审查、终审、重启和批准版本导出；不含主人作品或真实密钥。8081 是临时验收端口，不是部署服务；正式应用仍使用 5173/8000。运行结论与未完成的纯 UI 前置见 `WORKSTREAM-PLAN.md`、`UI-BACKLOG.md`。

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
