# 领域术语（CONTEXT）

这里只给**名字**下定义：是什么、代码里叫什么、归哪份文档管。**不解释实现**（那是
`ARCHITECTURE.md` 与各层 `description.md`），**不记理由**（那是 `DECISIONS.md`）。

| 中文 | 代码里的名字 | 一句话 | 详细归谁管 |
|---|---|---|---|
| 作品 / 书 | `Novel`, `novel_id` | 一部长篇的容器 | `backend/app/description.md` |
| 四层规划 A/B/C/D | `blueprint` / `toc` / `arcs` / `brief` | 蓝图→目录→剧情弧→单章简报；只有 B 目录那一行能写章名 | `ARCHITECTURE.md` §1、D-01 |
| 章号 | `Chapter.number` | **位置**，由顺序决定；删后前移、插后腾位 | D-29 / D-32 |
| 章名 | B 目录那一行 | 主人给的名字，`Chapter.title` 读时 join、不回写 | D-29 |
| 投影 | `documents.py` 渲染的 `.md` | DB 的通用格式外衣：给你读、给你改、给你导出；磁盘上没有这些文件 | D-02 / D-26 |
| 资料池 / 注入清单 | `collect_items()` / context manifest | 全仓唯一上下文构造器，对话与正文生成共用 | D-04 / D-06 |
| 预算 | 默认 12000 字 | 挤不下的那份**明写在界面上**，不悄悄丢 | `ARCHITECTURE.md` §2 |
| 提案 | `Proposal`, `stabilize_proposal` | Agent 只能提，主人在界面点应用才落库 | D-11 |
| 快照 / 删除记录 | `SNAPSHOT_KINDS = book,chapter,room,renumber,deleted,manual` | 动手前留现场；kind 记着它是为哪个动作留的 | D-30 |
| 腾位 | `made_room` | 恢复一章时把被那次删除挤下来的章整体后移让位 | 第二十八批批注 7 |
| 台子上 | `workbench.stage` | 前端唯一持有「当前哪本书/哪一章/哪个线程」的地方 | `frontend/src/store/description.md` |
| 线程 | conversation thread | 一条历史对话；**没有首句的线程不算一条** | D-31 |
| 思考过程 | `reasoning`（单独一列） | 绝不混进 `content` | D-18 |
| 供应商 / 任务 / 路由 | provider list / `TASKS` / `resolve_routing` | 一张列表 + 任务决定谁回答 | D-20 |
| 不可回退清单 | `UI-DESIGN.md` §0.9 ⇄ `uiInvariants.test.ts` | 视觉与交互决定的机器版 | `AGENTS.md` 第 3 步 |
| 删除区 | `DECISIONS.md` §2 与 §3 | 「已废止」与「防复活」的唯一记录；重建前先查这儿 | `AGENTS.md` 第 5 条 |
| 一条批注 | `UI-BACKLOG.md` 里的 `29.1` 这种编号 | 主人在界面上提的一条 bug 或需求；改完一条删一条 | `AGENTS.md`《UI 批注处理闭环》 |
| 主干 S0–S4 | 见 `ARCHITECTURE.md` §5 | 推进顺序，本表不解释含义 | `ARCHITECTURE.md` §5 |

**已知的一处二义（未裁定，别在代码里再制造第三个出处）**：树里写「全本蓝图」，
投影 label 与注入清单写「全书蓝图」。未结项在 `UI-BACKLOG.md` §一。
