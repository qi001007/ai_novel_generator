# 领域术语

这里只定义名字；实现看 ARCHITECTURE.md 和目录 description.md，理由看 DECISIONS.md。

| 中文 | 代码名 | 含义 |
|---|---|---|
| 作品 | Novel / novel_id | 一部长篇及其全部从属数据 |
| A/B/C/D | blueprint / toc / arcs / brief | 全书蓝图、目录、剧情弧、单章简报 |
| 章号 | Chapter.number | 位置；插入和删除时随顺序移动 |
| 章名 | TocEntry.title | 作者给出的名字，只由 B 目录持有 |
| 投影 | FileDoc / documents.py | 从数据库现渲染、可编辑和导出的 Markdown，不是磁盘真文件 |
| 资料池 | collect_items() | 对话与写文共用的唯一上下文采集入口 |
| 注入清单 | WritingContext manifest | 本轮实际给模型的资料、字符数、档位和裁剪原因 |
| 预算 | WRITING_CONTEXT_BUDGET | 写作上下文字符上限，当前默认 12000 |
| 提案 | Proposal | AI 建议的文档修改；主人应用后才写入 |
| 动作卡 | 待实现 | Agent 定位操作，主人确认后调用现有应用能力 |
| 推理 | reasoning | 与回答 content 分开的模型输出，不回灌历史正文 |
| 工具轨迹 | AgentStep | 一次工具调用的名称、参数、结果规模与耗时 |
| 线程 | conversation_id | 有首条用户消息后才进入历史列表的一轮对话 |
| 快照 | storage snapshot | 破坏性动作前的 SQLite 副本，reason 说明范围 |
| 台子上 | workbench.stage | 当前作品的栏面、活动页和文件恢复信息 |
| 不可回退项 | UI-DESIGN §0.9 | 界面决定及其 uiInvariants.test.ts 机器保护 |
| 删除区 | DECISIONS §2/§3 | 已废方案和被推翻证据；重建前必须先查 |
| v1 收尾 | WORKSTREAM P0 | 对话确认生成、上下文调整、Agent 收尾与真机验收 |
