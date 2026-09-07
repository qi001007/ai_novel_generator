# app/services/ —— 所有真正的判断都在这里

`context.py` 的 `collect_items()` 是**全仓唯一资料池**，对话与正文生成共用它（D-04/D-06）；
`prompts.py` 只管模板文本；`llm.py` 说这台网关的方言；`draft.py` 生成整章；
`chat.py` + `agent.py` + `agent_tools.py` 是对话与 Agent；`renumber.py` 是唯一允许搬章号的地方；
`documents.py` 写投影 `.md`；`storage.py` 管本机偏好与文件；`export.py` / `markdown_doc.py` /
`planning.py` / `reviews.py` / `chapters.py` 各管一件事。

**加资料只有一条路**：新上下文进 `collect_items()` 的一个分支，带来源标签和预算，
**不许**在调用方另拼一段 prompt、也不许改前端来迁就注入顺序（D-06）。
**Agent 红线**：`agent_tools.py` 的注册表里没有写正文的工具（只有读与搜）。要给它写权限，
先改裁定（D-28 / `docs/WORKSTREAM-PLAN.md §六`），别在这里偷偷加一个。
