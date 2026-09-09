# backend/app/services/ —— 业务与 AI 编排

context.py 的 collect_items() 是唯一资料池；documents.py + markdown_doc.py 管投影读写与语法；
renumber.py 管全部章号引用；storage.py 管快照与本机文件；errors.py 管领域错误。

chat.py 接对话事务；agent.py 管公共契约与 legacy 路径；agent_pydantic.py 管框架循环；
agent_model.py 翻译网关流；agent_tools.py 是只读工具注册表。llm.py 管供应商协议与路由。
draft/chapters/planning/reviews/export/prompts 各自服务对应业务，不把选择上下文的逻辑搬出 context.py。

修改本目录前先找唯一写者；若触及大文件，只提取当前需求涉及的部分。
