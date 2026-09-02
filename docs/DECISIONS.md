# 决策台账（DECISIONS）

本文件是「为什么长这样」的唯一记录。改架构前先查这里。
PRD 记需求，ARCHITECTURE 记现状，WORKSTREAM-PLAN 记进度，**理由和历史只写在这里**，别处只许引用编号。

状态只有四种：`生效` / `已废止`（写明被谁取代）/ `被推翻`（当初的取证是错的）/ `待裁定`。

最后更新：2026-09-03。原文追溯：`git show d9eb6a9:docs/WORKSTREAM-PLAN.md`（本文件拆出前的完整流水）。

---

## 1. 生效中

### D-01 四层规划的写入口只有一条：文档层（B 路）
主人 2026-09-03 裁定。

- 唯一写入口 = `PUT /api/novels/{id}/files/{path}`。四层规划的任何修改（人改、AI 提案、新建章节）都必须经过它。
- `routers/planning.py` 里 `briefs/toc/arcs/blueprints` 的 POST/PUT 端点降级退役，只读 GET 视需要保留。
  取代此前「`/planning/*` REST 通道保留不动」的口径（见 X-01）。
- 待办与节奏见 ARCHITECTURE 的 S3。

### D-02 DB 是唯一真源，`.md` 是投影
与 D-01 是一对，必须一起读，否则 B 路会被误读成「MD 变成真源」。

- `app/models.py` 里四层规划全是结构化列，**数据库不存文档文本**：`read_file()` 每次从列现渲染，
  `write_file()` 解析回列。所以换文件格式是纯投影层改动（零迁移、零 alembic）。
- 磁盘镜像导出列 P2，且只允许单向导出；双向同步 v1 明确不做（冲突解决没设计）。

### D-03 文件路径按章归组，一次改到位
主人 2026-09-03 裁定：与 D-01 同批做完，不分两轮（`resolve_path` 只动一遍）。

- 目标态：`chapters/0042/draft.md`（正文）+ `chapters/0042/brief.md`（D 简报）；A/B/C 仍为 `blueprint.md` / `toc.md` / `arcs.md`。
- 兼容：`resolve_path` 同时接受旧 `briefs/0042.md`，**读旧写新**，不断链、不迁数据。
- 数据契约不变：`chapter` 与 `chapter_brief` 仍是两张表，靠 `chapter_number` 配对。

### D-04 上下文注入只有一个构造器
- `collect_items()` 是唯一资料池；对话侧 `build_chat_context()` 与写作侧 `build_writing_context()`
  只是排序规则不同（问题相关度 vs 写作四档），共用 `WritingContext` 与同一份清单报告器。
- 蓝图只允许一个读者：`documents.active_blueprint()`（最新 active）。历史上出现过第三种读法（version 升序取最旧），已修。
- 分离的正确边界在**排序规则和模型配置**，不在采集层。把采集层拆两套 = 每类资料要写两遍且必然写歪。

### D-05 弧是存储，滑动窗口是派生视图
PRD 4.1。单文件滑块（窗口即存储、不可回查）与固定章窗（把弧劈两半、窗口与章号绑死）均已否决。

- 窗口每次生成现算，固定组成与顺序：A 蓝图 → B 目录邻域（N±3）→ C 当前弧（跨界附一弧收束摘要）
  → D 本章简报 → 事实库（出场人物当前状态 / 未回收伏笔 / 上一章结尾）。
- 「滑」的是注入选择，不是文件。窗口宽度只受 token 预算约束。

### D-06 注入清单双通道可观测，主人按清单增删机制
PRD 6.1。**这是本产品的核心业务逻辑，不是调试辅助**。

- 终端：`NOVEL_CONTEXT_DEBUG=1` 时打印清单（序号 / 档位 / kind / 标签 / 字符数 / 是否被裁 + 原因）。
- 落库：`generation_run.input_summary` 存 JSON，经 `GET /api/novels/{id}/chapters/{cid}/generation-runs` 回读。
- 迭代纪律：主人指认某个 `kind` 多余或缺失时，只改对应 collector，不改调用方、不改提示词模板、不改前端。
- 不变量：预算再紧也不得裁掉未回收伏笔与出场人物当前状态（有测试）。

### D-07 前端网络边界收敛在 `api.ts`
实测：`fetch(` 在全前端只出现在 `frontend/src/api.ts`。store 与组件对后端零感知。

- 要「能脱离后端看效果」的前端 demo，正确做法是在 `api.ts` 同接口下加一套 fixture 实现，**不新建目录、不复制代码**。
- 理由：摘出去必然两份前端漂移，而 51 个前端测试本来就是 mock fetch 的 demo 语义。

### D-08 编辑器组件 CodeMirror 6
2026-09-02 拍板 2。实际依赖 `codemirror@6.0.2` + state/view/language/commands，扩展在 `frontend/src/components/cmDoc.ts`。
TipTap 的选型记录作废（X-04）。

### D-09 D 层标题不重复章名
章名属于 B 层。D 简报文件标题写 `# 第 42 章简报（D 层 · 单章简报）`，不写章名，否则两层互相打架。

### D-10 键锁：结构锁定、值可改、AI 白名单
- 任何写者：小节标题（= 键名）与主键（`第 N 章` / `弧 N`）增删改名一律 422；`chapter` 必须等于文件名章号。
- `actor=ai`：额外只许改白名单字段（A 全 5 / B title·plot_function·notes / C title·objective·conflict·resolution·status / D 除 chapter·arc 外全部），不许增删条目。
- `actor=human`：可增删目录条目（消失的行置 `is_active=false`，不物理删）。

### D-11 提案稳定化
见 T-09。AI 返回的整份文档在展示成 diff 前，先按当前文件把「没打算改的小节」还原成原文，
保证未改动部分逐字节不变。写回通道不因重排而拒收合法改写。

### D-12 v1 不做向量 RAG
PRD v1 非目标 2。`collect_items()` + 字符预算 + n-gram 相关度排序**已经是检索**，只是检索器是 SQL 而非向量。

- 上向量检索的唯一合法触发条件：连续看过注入清单，出现一次可复现的「该给的章节没给」，
  且确认是排序错而不是没采集到。没有这个失败案例之前不做。
- UI-DESIGN 第 83 行「选 MD 是因为将来可向量化」是**选型理由**，不是 v1 承诺。

### D-13 章号 v1 只允许末尾追加
中间插入要连带改简报文件名、B 层锚点章号、C 层弧范围、正文 `chapter_number` 外键，漏一处即不一致 → P2。

### D-14 新建章节是写作环前置动作，不依赖对话 Agent
PRD Phase 1 第 11 条。三通道（树底按钮 / 右键菜单 / `Ctrl+Alt+N`）共享同一个 store action，
一次同时建 `Chapter` 与对应 brief 且章号一致。

---

## 2. 已废止（禁止据以行动）

| 编号 | 旧口径 | 废止于 | 原因 |
|---|---|---|---|
| X-01 | 「后端 `/planning/*` REST 通道保留不动，它仍是结构化真源」 | 2026-09-03 D-01 | 与 B 路方向相反，会造成双真源漂移 |
| X-02 | 文件面是 YAML（`blueprint.yaml` / `briefs/00NN.yaml`、`dump_document`、`|-` 块标量） | 2026-09-02 commit `b6a4acd` | 主人拍板改 MD；函数现为 `render_document` / `markdown_doc.render` |
| X-03 | 「点一下最新章节就自动建下一章」 | 2026-09-02 主人第三次纠正 | 要显式入口（D-14） |
| X-04 | 正文编辑器用 TipTap | 2026-09-02 拍板 2 | 改 CodeMirror 6（D-08） |
| X-05 | 表单式规划编辑面板 `PlanningPanel.tsx` | commit `34f36ef` 前后 | 「一切规划皆文档」，A/B/C 徽章改为直接打开对应 `.md` |
| X-06 | HANDOFF《待我拍板》三件 | 已全部裁定 | 拍板 1 = B→D 按字段映射跳转（`plot_function→goal`、`notes→events`，不动后端不丢数据）；拍板 2 = CodeMirror 6；拍板 3 = D 层是文件节点 |
| X-07 | 「后端 pytest 99 条」 | 2026-09-03 实测 | 现为 **101 passed**（前端 51） |

---

## 3. 被推翻的取证（写死，防止复活）

| 编号 | 当初的错误结论 | 真相 | 教训 |
|---|---|---|---|
| R-01 | 「超算网关 401 / API key 过期」，连续报错两轮 | 取证脚本用 `Split('=')[1]` 从 `.env` 取 key，而 key 是 base64 带 `=` 填充，最后那位被切掉（46→45）。正确取法 → HTTP 200；后端 `load_dotenv()` 从来不截断 | 断言「外部服务挂了」之前，先打印自己取到凭据的长度与结尾字符 |
| R-02 | 「`use_figma` 工具不存在 / 工具面在掉」，同会话自我叙述 100+ 次 | 路由器真实拒绝 **0 次**，工具结果里出现「不存在」原文 **0 次** | 只转述工具结果里逐字存在的字符串；结果没回来之前不预判结论 |
| R-03 | 「MD 迁移弄丢了 briefs 0044-0047」 | 查库证伪：`chapter_brief` 全库仅 3 行，那几行从来是前端伪造的（见 T-07） | 看到行数不对，先分清是存储少了还是投影多了 |

---

## 4. 可复用技术取证（踩坑台账）

| 编号 | 结论 | 出处 |
|---|---|---|
| T-01 | 在 `use_figma` 里给既有 FRAME 赋 `.width` 会让整段脚本**静默失败**（只回 `safeToRetryWithoutCanvasRead`，画布零变化，三次复现）；只赋 `.x/.y` 正常 | C5d 收尾 |
| T-02 | `menu.effects = [{type:"DROP_SHADOW", …}]` 报 `in set_effects: Expected [0] to be one of…`；去掉 effects 同段脚本立即成功。弹层用 1px 描边 + 重叠表达 | C7 |
| T-03 | `createEllipse()` 是几何节点不是容器，`appendChild` 抛错并**整段回滚**。要编号圆点用 `createFrame()` + `cornerRadius = w/2`，或把数字作兄弟节点居中 | C7 |
| T-04 | `safeToRetryWithoutCanvasRead` 是**写失败静默返回**，不是错误串也不是额度。判据 = 事后 `get_metadata` 看节点在不在 | C7 |
| T-05 | 注入清单选 `print` + flush 不选 `logging`：uvicorn 的 LOGGING_CONFIG 不配 root logger，自造 logger 的 INFO 会被 lastResort 咽掉 | C5d 治本 |
| T-06 | SSE 生成器自带 Session：FastAPI 的 yield 依赖在流开始前就关掉请求级 session，落库会失败。路由里 `_event_stream(…, lambda: Session(bind))` | C5 |
| T-07 | 文件投影 `reload()` 把读过的每个路径塞进 `metas`，于是只渲染不入库的「未建」占位变成真行、点一次往后挪一格。修复：`metas` 只在真实写入后经 `syncMetas()` 刷新 | `e07c621` |
| T-08 | 提案卡活不过刷新：`fromHistory()` 只重建文本气泡不重建 proposals，「点一下写回」断掉。修法走服务端真源——`GET /chat/messages` 返回 `ChatMessageOut`（带现算的 `proposals`），前端加载历史后重建卡片，`baseText === data.text` 判已应用不再复活 | C5d 发现 2 |
| T-09 | 模型会顺手重排整份文档（只要求改 `## 约束` 第二条，回了整体重排 + 重新折行，diff 47 行）。键锁挡得住改标题，挡不住重排；prompt 里加「其余逐字节保持原样」不足治 → 解法见 D-11 | C6 风险 1 |
| T-10 | MiniMax-M2.5 是推理模型，四字请求也烧掉 324 个 `completion_tokens`（reasoning 计入输出）。`token_output` 记成 324 是真实账单口径，不是 bug | C5d |
| T-11 | 从 `backend/.env` 取值禁用 `Split` 按等号切，改用 `Substring('NOVEL_LLM_API_KEY='.Length)`（见 R-01） | C5d |
| T-12 | Figma 帧 05（框选双栏）**不是过时稿**：它是 REQUIREMENTS 里未做的 v1 选区修改，属 backlog，保留 | C5b |
| T-13 | 围栏兼容垫片：`PROPOSAL_BLOCK` 同时收 `yaml / yml / md / markdown @路径`，旧格式提案不因迁移而丢 | C6 收口 |

---

## 5. 待裁定（存量，未结）

| 编号 | 事项 | 现状 |
|---|---|---|
| Q-01 | 19 个只被旧表单视图用过的死样式类（`toc-page` `toc-tree` `toc-detail*` `blueprint-page` `blueprint-doc*` `version-chips` `item-list` `segmented`） | 未擅自扩大清理面，等主人一句话再扫 |
| Q-02 | novel 3「MD探针」是验证迁移造的测试作品，要不要删 | **`routers/novels.py` 只有 GET/POST/PUT，没有 DELETE 端点**，删不掉。要么加端点，要么直改库 |
| Q-03 | 帧 20「树右键菜单与新建章节入口」未落 4 项（`note-why` 注记 / `spec-col` 规格 / `legend` 图例 / 三个编号圆点） | 帧已批准、三通道代码已落地（`58b8da4`），补规格价值下降，待定 |
| Q-04 | 人物页工具行的分级 Tab 仍是分段控件，帧 08 画的是各自独立 chip | 未列入重做项，暂未改 |
| Q-05 | 帧 21（B 层目录列表）/ 帧 22（绘画详情）审批 | 2026-09-02 已出待批，UI 铁律要求批前不写前端 |
| Q-06 | A 路端点退役的具体节奏 | 归 S3 方案里定，不在文档层面空转 |

---

## 6. 文档职责（改文档时照这个分工，别再往一处堆）

| 文件 | 只装什么 | 明确不装什么 |
|---|---|---|
| `AGENTS.md` | 工具纪律、回答习惯、**项目架构红线**（一句话级别、违反即错） | 架构解释、进度、历史 |
| `docs/ARCHITECTURE.md` | 真源与写通路、模块**实际**完成度、S0–S3 主干 | 需求条目、视觉规格、为什么这样定的理由 |
| `docs/PRD.md` | 需求与验收标准 | 文件路径实现细节、进度、理由历史 |
| `docs/REQUIREMENTS.md` | PRD 的功能拆解勾选 | 设计令牌、架构决策 |
| `docs/UI-DESIGN.md` | 视觉与交互规格 | 后端契约、进度 |
| `docs/WORKSTREAM-PLAN.md` | 当前主干进度与勾选 | 已完成的历史纪要（去 DECISIONS）、后端契约（去 ARCHITECTURE） |
| `docs/HANDOFF.md` | 开新对话所需的最小信息：环境、验证命令、指向 | 上面任何一类的正文 |

一句旧账：「AI 不自觉补后端」的根因不是模型手贱，是**没有任何一份文档写着「不许新增写通路」**。
每场新对话读的是 HANDOFF + WORKSTREAM-PLAN，而那两份当时在讲 YAML 和帧审批。
