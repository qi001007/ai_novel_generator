# backend/app/services/ —— 业务与 AI 编排

context_planner.py 是新模型的唯一动态资料选择器；旧链路在退役前仍由 context.py 的 collect_items() 管资料池。documents.py + markdown_doc.py 管投影读写与语法；
renumber.py 管全部章号引用；storage.py 管快照与本机文件；errors.py 管领域错误。

chat.py 接对话事务；agent.py 只保留公共契约与网关协议；agent_pydantic.py 是唯一工具循环；
agent_model.py 翻译网关流；agent_tools.py 提供只读观察与统一命令工具；agent_run_log.py 统一保存 AgentRun/ToolCall 与审批状态，所有写入仍由命令目录负责。llm.py 管供应商协议与路由。
workflow_engine.py 执行不可变版本并记录节点；python_worker.py 是可替换的本地纯计算进程边界，不宣称安全沙箱。
generation.py 运行当前已发布正文流程并保存候选；接受由 documents.py 的唯一文件写入口校验版本并记录 Operation（统一命令迁移仍待完成）。
draft/chapters/planning/reviews/export/prompts 各自服务对应业务，不自行复制上下文选择逻辑。

修改本目录前先找唯一写者；若触及大文件，只提取当前需求涉及的部分。
