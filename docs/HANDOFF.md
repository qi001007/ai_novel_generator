# 新会话入口

最后核对：2026-09-09。本文件只保存启动、读序和验证入口；工作纪律以根目录 AGENTS.md 为准。

## 1. 开始任务

1. 读 ARCHITECTURE.md §0.5，定位目录。
2. 读 WORKSTREAM-PLAN.md，确认事项仍在 v1 范围且没有被延期。
3. 要恢复旧方案时，先查 DECISIONS.md §2/§3 删除区；要理解理由时只读相关 D-xx。
4. 进入目标目录，先读 description.md；确定动工后再读同层 backlog.md。
5. 界面事项还要读 UI-BACKLOG.md 对应条目与 UI-DESIGN.md §0.9。

不要先全仓扫描，不要把所有 docs 一次注入；上面五步足以把读取范围缩到目标目录。

## 2. 环境

- 仓库：E:\novel-generator
- 后端：Python 3.11、FastAPI、SQLModel、SQLite；必须使用 backend\.venv，不能用 Anaconda base。
- 前端：React 18.3.1、TypeScript、Vite。
- 后端端口 8000，前端端口 5173；Vite 把 /api 代理到后端。
- LLM 运行配置以数据库 app_config 为主，backend\.env 只作种子与兜底；密钥不得打印或提交。
- NOVEL_AGENT_ENGINE=pydantic 才启用 Pydantic AI，未设置时使用 legacy。

## 3. 启动

后端：

    cd E:\novel-generator\backend
    .venv\Scripts\python.exe -m alembic upgrade head
    $env:NOVEL_CONTEXT_DEBUG = '1'
    .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

前端：

    cd E:\novel-generator\frontend
    npm.cmd run dev

若接口表现与代码不符，先检查 8000 端口是否有旧解释器进程；不要在同一端口叠起第二个后端。

## 4. 门禁

后端：

    cd E:\novel-generator\backend
    .venv\Scripts\python.exe -m pytest -q

前端：

    cd E:\novel-generator\frontend
    npm run test -- --run
    npx tsc -b --force --pretty false
    npm run build

目录说明治理包含在后端测试的 tests/test_folder_docs.py 中。文档不保存固定测试条数；以当前命令退出码和实际汇总为准。

写作环离线冒烟：

    cd E:\novel-generator\backend
    .venv\Scripts\python.exe scripts\writing_ring_smoke.py

加 --live 才调用真实模型，必须使用隔离作品或临时数据库。对话 Agent 真机冒烟先启动后端，再运行 scripts/smoke_chat_stream.py。

## 5. 界面取证

- 改界面时同批更新 frontend/src/uiInvariants.test.ts，不减少断言。
- 效果类改动必须用 Edge + CDP 真机截图；通道与脚本限制见 AGENTS.md。
- 命中区审计要求 small / clipped / unreachable 为 0；屏外或半屏外元素先校验脚本判据，避免假阳性。

## 6. 交付

- 只修改请求涉及的目录；每个改过的目录在 backlog.md 增加一条简短记录。
- 先跑相关测试，再跑全部门禁；测试绿只能证明既有断言成立，功能仍需真实流程验证。
- 更新状态只改 WORKSTREAM-PLAN.md；已完成 UI 条目从 UI-BACKLOG.md 删除；理由变化才改 DECISIONS.md。
- GitHub 操作优先使用 GitHub MCP；是否 commit 或 push 服从当前任务授权。
