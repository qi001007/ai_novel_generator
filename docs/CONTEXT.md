# 领域术语

这里只定义当前名字；产品范围看 `PRD.md`，实现看 `ARCHITECTURE.md` 和目录 `description.md`，理由与废止项看 `DECISIONS.md`。

| 中文 | 代码名 | 含义 |
|---|---|---|
| 作品 | `Novel` / `novel_id` | 一部长篇及其全部从属数据与工作台状态 |
| 结构节点 | `OutlineNode` | 卷、章节和阶段组成的树形结构节点 |
| 文档 | `Document` | 主链路、卷规划、章节规划、正文或普通 Markdown |
| 资料条目 | `KnowledgeEntry` | 人物、世界规则、地点、组织、伏笔或研究资料 |
| 稳定事实 | `Fact(status=approved)` | 经主人确认、允许进入稳定上下文的事实 |
| 修订 | `Revision` / `revision` | 资产版本及乐观并发控制值 |
| 操作 | `Operation` | 一次命令的输入、差异、影响对象、结果与撤销数据 |
| 平台函数 | command / function catalog | 页面、Agent 与 Workflow 共用的受约束业务能力 |
| 预览 | command preview | 执行高风险操作前的参数校验、影响范围和真实差异 |
| 撤销 | operation undo | 使用 Operation 保存的逆向数据恢复可逆写入 |
| 对话运行 | `AgentRun` | 一轮 Agent 的状态、消息、工具、审批和恢复信息 |
| 工具调用 | `ToolCall` | Agent 对统一平台函数的一次结构化调用 |
| Workflow 定义 | `WorkflowDefinition` | 可编辑的小说生产流程 |
| Workflow 版本 | `WorkflowVersion` | 发布后不可变、供历史运行固定引用的流程版本 |
| 节点运行 | `NodeRun` | 单个 Workflow 节点的输入输出、耗时、Token 和错误 |
| 动态上下文 | context preview / planner | 按任务、结构距离、审批状态、相关性和预算实时选择的资料 |
| 必选锚点 | required anchors | 当前章节生成一定需要的作品核心、结构路径、规划和承接内容 |
| 候选资料 | candidates | 可能注入的邻近章节、人物、世界、地点、伏笔和研究资料 |
| Minimap | `.minimap` | 编辑器唯一可见纵向滚动轨道；原生滚动条隐藏 |
| 地图工程 | `MapProject` | 坐标化图块、生成任务和拼接关系的容器 |
| 图块 | `MapTile` | 可独立生成、预览、确认和重新生成的地图区域 |
| 重建前历史 | Git archive / deleted zone | 可追溯但不得直接作为当前实现依据的旧架构与废案 |

重建前的 A/B/C/D、固定滑动窗口、旧 Workflow policy 和旧双 Agent 名称只用于读历史数据或 Git 证据，不再定义新模型。
