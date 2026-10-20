# 重建架构

## 1. 目标结构

```text
React 页面 / Agent / Workflow
             ↓
       统一函数与命令目录
             ↓
          应用用例层
             ↓
作品结构 / 文档规划 / 知识事实 / Workflow / 生成审计 / 地图媒体
             ↓
     仓储 / 单事务 / 模型网关 / 搜索 / 文件存储
```

FastAPI、SQLModel、Alembic 与 SQLite 继续组成单体应用。新模型避免 SQLite 专属设计，为 PostgreSQL 和对象存储保留适配器边界。

## 0. 代码地图

### 0.5 Map 跳转表

| 任务 | 当前入口 |
|---|---|
| 统一命令目录与事务 | `backend/app/core/commands.py`、`backend/app/application/functions.py` |
| 新核心模型 | `backend/app/models.py`、`backend/alembic/versions/` |
| Workspace / SSE / 上下文 | `backend/app/routers/workspace.py`、`events.py`、`context.py` |
| Agent 单一路径 | `backend/app/services/agent.py`、`agent_pydantic.py`、`agent_tools.py`、`agent_run_log.py`、`frontend/src/components/ChatPane.tsx` |
| Workflow DSL 与运行 | `backend/app/application/workflow_schema.py`、`backend/app/services/workflows.py`、`workflow_engine.py`、`python_worker.py`、`backend/app/routers/workflows.py` |
| 启动页与工作台 | `frontend/src/pages/BookshelfPage.tsx`、`WorkbenchPage.tsx` |
| Workflow Studio | `frontend/src/components/ContextWorkflowPanel.tsx`、`JsonCodeEditor.tsx` |
| 前端网络边界 | `frontend/src/api.ts` |
| 模型与生图网关 | `backend/app/services/llm.py`、`backend/app/routers/config.py`、`images.py` |
| Codex 平台操控 MCP | `tools/novel_platform_mcp/server.py`、`client.py`、`install.ps1`、`smoke_test.py` |

## 3. 新核心模型

`Novel`、`OutlineNode`、`Document`、`KnowledgeEntry`、`Fact`、`Revision`、`Operation`、`WorkflowVersion`、`WorkflowRun`、`NodeRun`、`Conversation`、`ToolCall`、`MapProject`、`MapTile`、`GenerationJob`。消息仍由现有 `ChatMessage` 承载，Workflow 定义仍在收口为独立模型。

可编辑资产统一使用 revision 乐观锁和 draft/approved/retired 状态；Workflow 定义已具备 revision，其创建、保存、重命名、默认切换、发布和删除都进入统一命令。删除只允许未发布、未运行的草稿，已有历史的流程必须保留；Operation 保存命令输入、差异、影响对象、执行者和撤销数据，历史运行固定引用不可变 WorkflowVersion。

## 4. 不可绕过的边界

- 路由、Agent 与 Workflow 不得直接提交数据库；写入必须进入统一命令处理器。
- 同一命令只有一个事务提交点；幂等键和目标 revision 在执行前校验。
- Python 节点不得访问仓储、数据库或平台函数，只接收声明输入并返回 JSON。
- 动态上下文每次调用重新计算；只有 approved Fact 可进入稳定事实区。
- Workflow 图是执行真源；不得再维护独立 policy 作为另一份执行定义。
- 历史调用读取当时快照，不从当前配置反推。

## 5. 当前过渡边界

新核心已与旧路由并存，以保护现有可用前端；旧 documents/context/chat 服务仍有历史职责，禁止继续扩张。尚未迁入统一核心的功能在 `WORKSTREAM-PLAN.md` 和 `UI-BACKLOG.md` 明列，不能称为重建完成。

开发侧 `novel_platform` MCP 只通过本地 HTTP API 操作平台，不直连数据库。统一命令已经覆盖的动作优先走命令；尚未迁移的旧能力通过受限的 `/api/*` 读写工具临时覆盖。页面验收只允许 click/input/scroll/drag 白名单与 DOM 测量，不开放任意脚本。MCP 不属于产品 UI，也不等同于产品内对话 Agent；它验证并驱动产品 Agent 将来要复用的同一函数能力。

模型网关当前默认接入百炼 Token Plan：正文使用 `qwen3.7-plus`，审稿、摘要与对话使用 `qwen3.8-flash`，无计费 `/models` 鉴权已返回 HTTP 200。生图走同一供应商路由和 `/api/images/generations` 传输边界，但 `sk-sp-` Token Plan 密钥经文本 Base URL 直调图片会按官方规则返回 400；正式启用必须新增百炼标准 `sk-` 生图供应商及对应地域/Workspace URL，不能把文本密钥复用成假可用状态。

### 0.6 文档职责

| 文件 | 唯一职责 |
|---|---|
| `PRD.md` | 当前产品需求与正式验收 |
| `ARCHITECTURE.md` | 当前代码地图、目标边界与过渡事实 |
| `DECISIONS.md` | 仍有效且影响实现的决定 |
| `WORKSTREAM-PLAN.md` | 已完成、当前施工和未完成阶段 |
| `UI-DESIGN.md` | 稳定界面语言 |
| `UI-BACKLOG.md` | 尚未完成、可验证的反馈项 |
| `HANDOFF.md` | 启动、验证和接手入口 |
