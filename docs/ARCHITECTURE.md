# 架构现状

最后核对：2026-09-09。本文只描述跨模块的真实结构；进度看 WORKSTREAM-PLAN.md，理由看 DECISIONS.md。

## 0. 系统形状

    React 单页应用
      → frontend/src/api.ts（唯一网络边界）
      → FastAPI routers（HTTP 解析与错误映射）
      → services（业务、投影、AI 编排）
      → SQLite / SQLModel（唯一持久化真源）

这是单机自用应用。前后端共用一套数据模型，但写文与对话是两条消费链：写文生成章节，对话负责检索、讨论和提出改动；二者都从 collect_items() 取得资料。

### 0.5 Map 跳转表（改什么，先读哪里）

| 任务 | 先读 | 验证 |
|---|---|---|
| 表或字段 | backend/app/description.md → models.py；backend/alembic/description.md | 迁移升降级 + 后端测试 |
| API | backend/app/routers/description.md | 对应路由测试 |
| 生成、恢复、校验 | backend/app/services/description.md | 后端测试 + 对应 smoke |
| 注入内容 | services/context.py 的 collect_items() 及写作排序 | 清单测试 + NOVEL_CONTEXT_DEBUG=1 |
| 对话 Agent | services/agent*.py、agent_tools.py、chat.py | test_agent_*.py + 真网关最小冒烟 |
| 页面 | frontend/src/pages/description.md | Vitest + 类型检查 + 真机截图 |
| 组件 | frontend/src/components/description.md | 同名测试 + uiInvariants.test.ts |
| 状态 | frontend/src/store/description.md | store 测试 |
| 决策原因或已删方案 | DECISIONS.md 索引、§2、§3 | 对照当前代码后再行动 |

进入目录后先读同层 description.md；确定要改，再读同层 backlog.md。不要从仓库根目录全量读取源码。

### 0.6 文档职责

| 文件 | 唯一职责 |
|---|---|
| AGENTS.md | 工作纪律、不可违反的项目红线 |
| ARCHITECTURE.md | 跨模块现状、代码地图、风险边界 |
| PRD.md | 产品目标、范围、验收标准 |
| UI-DESIGN.md | 当前视觉与交互规格、不可回退项 |
| WORKSTREAM-PLAN.md | 唯一进度入口、下一步、收尾标准 |
| UI-BACKLOG.md | 尚未完成的界面批注，完成即删 |
| DECISIONS.md | 决定、理由、废止与防复活记录 |
| HANDOFF.md | 新会话启动与验证入口 |
| CONTEXT.md | 领域词汇表 |
| 目录 description.md / backlog.md | 本层职责与本层变更史 |

## 1. 数据与写通路

- app/models.py 定义 16 张表；其中 app_config 是全局配置，其余数据按作品归属。
- SQLite 是唯一持久化真源。blueprint.md、toc.md、arcs.md、chapters/NNNN/{brief.md,draft.md} 与 settings/* 都是按需渲染的 Markdown 投影，不是磁盘真文件。
- 规划与文本设定写入只走 PUT /api/novels/{id}/files/{path}，统一经过结构锁、AI 字段白名单和 base_revision 并发检查（D-01/D-02/D-10/D-15）。
- 主人确认的首次 B/C 提案可以初始化空投影；已有记录仍禁止 AI 提案增删或改主键（D-38）。
- /planning/* 的写路由保留为 410 退役桩，避免旧调用静默产生第二写口；读取仍可用。
- 图片、作品删除、章节生成和快照恢复是不同资源动作，不伪装成规划文档写入。章节改名最终仍写 toc.md；章节删插由 renumber.py 集中搬移全部章号引用（D-29/D-32）。
- 导出是单向读；恢复写回时复用文件投影写手。v1 不做磁盘双向同步。

## 2. AI 与上下文

    collect_items(session, novel_id)
      ├─ build_chat_context()      按问题相关度排序
      └─ build_writing_context()   按写作层级与字符预算排序
           └─ manifest → generation_run.input_summary / 调试终端

- collect_items() 是唯一资料池；新资料只增加 collector，不在调用方拼第二份提示词（D-04/D-06）。
- 对话历史、推理、工具轨迹和正文内容分开建模；推理不回灌为历史正文（D-18）。
- Agent 的工具注册表当前只有 list_files、read_file、web_search，没有直接写工具。改规划只能产出提案，主人确认后再走文件写入口。
- Agent 有 legacy 与 Pydantic AI 两个引擎；NOVEL_AGENT_ENGINE=pydantic 才启用后者，默认仍是 legacy。两者共享注册表和外部事件契约；迁移结束前不得删回退路径（D-28）。
- 当前写作上下文仍使用 12000 字预算、目录邻域 ±3、上一章末尾 600 字；这些是待调整的实现现状，不是新需求的最终口径，工单见 UI-BACKLOG.md。

## 3. 前端边界

- api.ts 是唯一 fetch 所在地；组件、页面和 store 不直接感知后端实现（D-07）。
- workbench、files、appearance 是三个状态持有者；新增全局状态前先证明现有三处不能承载。
- CodeMirror 6 承担 Markdown/正文编辑；投影语法只由后端 markdown_doc._GRAMMAR 发布，前端按 kind 消费（D-08/D-35）。
- 视觉决定由 UI-DESIGN.md 描述、uiInvariants.test.ts 机械保护；效果类改动必须真机量测。

## 4. 结构风险

| 风险 | 当前证据 | 收尾策略 |
|---|---|---|
| 大文件 | styles.css 6569 行；ChatPane.tsx 1174；PreferencesPage.tsx 1143；WorkbenchPage.tsx 1001 | 不做全量重构；功能触及某块时只拆该块，并保持测试不减 |
| 后端服务过厚 | documents.py 1169；context.py 900；chat.py 686；storage.py 581 | 先完成 v1 主链；仅在修改相应职责时提取纯函数或子模块 |
| Agent 双引擎 | 默认 legacy，Pydantic 路径已存在但尚未完成迁移 | 先补行为等价与真机稳定性，再切默认，最后删 legacy |
| 前端主包偏大 | 当前生产构建主 JS 约 874 KB（gzip 约 296 KB），Vite 给出 500 KB 提示 | 不阻塞本地 v1；真实启动变慢时先做路由级 dynamic import |
| 测试卫生 | 前端测试通过，但 BookshelfPage 与 FileEditorPane 各有 act(...) 警告 | 不混入文档任务；后续触及对应测试时修 |
| 文档漂移 | 多份文档曾重复测试数字、已完成流水和旧结论 | 禁止固定测试条数；状态只写 WORKSTREAM-PLAN.md，历史交给 Git |

## 5. 运行时核对

2026-09-09 本机导入应用得到 74 条 /api 路由、16 张表。测试总数不写入文档，以门禁当次输出与退出码为准。启动与完整验证命令只看 HANDOFF.md。
