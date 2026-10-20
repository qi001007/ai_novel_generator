# application

平台函数的输入模型、业务校验和处理器；`workflow_schema.py` 是 Workflow 图与策略的共享严格契约。
处理器只操作领域对象并 `flush`，提交、回滚、审计和事件统一由核心执行器负责。
