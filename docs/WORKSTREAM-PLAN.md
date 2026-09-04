# 推进计划书

**本文件只记进度与勾选。** 已完成的历史纪要一律进 `DECISIONS.md`，不再往本文件末尾追加流水
（旧版涨到 619 行 / 51KB、C6 与 C7 各撞号两次，就是这个习惯造成的）。

工作规则：

1. 开工先读本文件《状态看板》+《主干》，再读 `ARCHITECTURE.md` 确认现状与缺口。
2. 只做当前 S 步骤范围内的任务，别的发现只记录不顺手改。
3. 每完成一项打勾；改需求先改 PRD，再同步 REQUIREMENTS / UI-DESIGN；理由进 DECISIONS。
4. 每步收尾必须：后端 pytest + 前端 vitest + build 全绿，commit + push（走代理）。

---

## 状态看板

当前进行到：**S1 最小写作环已完成，下一步 S2 agentic 内核**（2026-09-03）。

- 后端 107 passed / 前端 53 passed / build 干净（2026-09-03 实测）。
- 主干与 UI 支线**可并行**，但 S3 必须早于 S2，理由见 `ARCHITECTURE.md` §5。

---

## 一、主干（S 系列）

### S0 上下文可观测演示

- [x] 单构造器 + 四档排序 + 清单双通道（后端 `c385f5b` / `b397081`）
- [x] 后端跑在可见终端、控制台 UTF-8
- [x] 只读跑出两份真实清单（novel 1 第 43 章 944/12000；novel 3 第 43 章 83/12000）
- [x] 清单当场抓到缺陷：空简报冒充「必注入 0 字」→ 已修（装配层过滤 + 测试，102 passed，见 T-14）
- [ ] 走 `/generate` 全链真调一次 API（会写正文与 generation_run，等主人点头）
- [ ] 主人据清单指认「哪个 kind 该删 / 该加」，形成下一批 collector 调整

验收：主人在终端亲眼看到一份清单，并能就着它说出至少一条增删意见。

### S1 最小写作环

- [x] 一个隔离脚本：空临时库 → 建一部小说 → 文件层写规划 → 一次注入 → 出正文
- [x] 脚本中途打印注入清单；2026-09-03 实测 9 块 / 354 字，`PASS`
- [x] 对话侧与写作侧的预算常量、裁剪循环合并成一份（REQUIREMENTS 10.1 末条）：
      两种排序结果统一交给 `apply_context_budget()`
- [x] 脚本入库为 `backend/scripts/writing_ring_smoke.py`，可重复执行；
      默认 `offline-template` 不耗 token，`--live` 才调真实 draft 模型

验收：一条命令跑通，输出含正文与清单，退出码 0。

### S3 写通路收口 + 路径迁移（★ 必须先于 S2）

主人 2026-09-03 裁定：B 路为唯一写入口（D-01），路径迁移同批做（D-03）。

- [x] 先写测试：`/planning/*` 的 POST/PUT 不可再用（返回 410）；`resolve_path` 新旧路径双向可解析
- [x] 新建章节改走文件层：一次写入同事务建 `Chapter` 与 `chapters/{N}/brief.md`
- [x] 文件层补齐「新建文件」能力：`chapters/{N}/brief.md` 首写自动建简报与正文行
- [x] `resolve_path` 支持 `chapters/0042/brief.md`，**读旧写新**，旧 `briefs/0042.md` 仍可读
- [x] 正文投影成 `chapters/0042/draft.md`（`EditorPane` / 对话 `/save` 与文件层同一条写通路；
      旧 `POST / PUT /chapters...` 已返回 410）
- [x] `routers/planning.py` 退役写端点，只读 GET 按需保留
- [x] 前端 `store/files.ts` 路径常量与左树 `briefs/` 分组换成按章归组
- [ ] 因退役而变无用的导入/助手删掉（不顺手删既有死样式 → 归 U7）

验收：全仓只剩一条写四层规划的路径；`/planning/*` 只剩 GET；新旧路径往返测试通过；
后端测试数不降（≥101），前端 52 全绿，build 干净。

### S2 agentic 内核

- [x] 工具注册表 + 多步循环：`services/agent.py` 的 `ToolRegistry` 与 `stream_agent_turn`。
      **协议是自己定义的文本块而不是 OpenAI `tools`**——本机网关实测 `finish_reason: stop` 且回包
      **没有 `tool_calls` 字段**，MiniMax-M2.5 把调用写成私有 XML 混在 `content` 里；照原生通道写
      循环永不触发、还会把 XML 泄漏进正文。`tool_calls` 若存在仍一并识别。
      流式侧带 hold-back：未闭合围栏之后的文字一律先扣住，控制块永不上屏（`done` 事件不得冲掉工具轨迹，已补测试）。
- [x] 联网搜索工具：`web_search` 走中文维基百科检索（免密钥、实测可用）；前端补 `/search <词>` 命令。
      DuckDuckGo lite/html 本机实测 **403**，所以通用网页结果需要另配搜索 API，没有凭据时如实报失败而不是编结果。
- [x] 本系统内部命令：`list_files` / `read_file` 读的就是文件层那一份文档（同一个 `documents.read_file`）。
      **注册表里没有写工具**（有测试钉住名字集合）：改规划仍只有「提案 → 主人点应用 → `actor=ai`」这一条，
      与 D-01 / D-15 不冲突。
- [x] `prepare_turn()` 复用为循环每圈的输入侧：循环只在它给的 messages 上追加，不重建上下文装配。
- [x] 每圈步数与 token 上限（默认 4 步 / 30000 token，`AgentConfig` 可调），**超限抛 `AgentBudgetError`**：
      SSE 出 `error` 且**不落库半截回答**（`test_agent_chat.py` 钉住「error 有、done 无、assistant 行为空」）。

验收：一句自然语言「把 45-48 章收进第二个弧并补钩子」→ Agent 自己走 读 → 提案 → 人点应用，
全程不产生第二条写通路，且注入清单能看出它读了什么。
**已验到**：读→提案→应用整条链（`test_agent_chat.py`，含控制块不外泄、超限不落库）；
真机一轮 `/search` 走通两步、详情面板显示「本轮读取 · web_search(...)」、来源链接可点。
**未验到**：主人原话那句「45-48 章收进第二个弧」没拿真实模型跑过（novel 1 只有 1 章，构造不出该场景）。

### S4 合流

- [ ] 对话式管理接上写作环（Agent 能触发 S1 那条链）
- [ ] Ctrl+K 全局命令面板（旧 C4a 遗留）

---

## 二、UI 支线（U 系列，不阻塞主干）

### U1 编辑器高级能力（旧 C4）

- [ ] 双栏对照生成（`/generate` 流式，逐段合并）— Figma 帧 05 已批，代码未做
- [x] `/generate` SSE 流式接通：正文编辑器与 `draft.md` 缓冲在生成中实时追加；
      双栏对照与逐段合并仍待做
- [ ] 选区修改（浮动工具条 → Diff → 逐处接受/拒绝）
- [ ] 内联审稿（高亮锚点 + 批注气泡 + 七维报告抽屉）
- [ ] Ctrl+F 查找条 + 全量快捷键接线
- [ ] 版本历史侧栏；自动保存状态指示

### U2 帧 21：B 层目录列表视图与搜索（已批准，主体落地）

- [x] 帧 21 已出（节点 `460:6`），自查修掉两处缺陷：保存按钮溢出 596 宽面板、控件内文字底部切掉
- [x] 批准后实现：列表视图 + 行内改名即存 + 本地搜索 + 源码开关（两视图共用一份数据，不产生第二真源）
      命中字段已高亮；自动滚动定位待补

### U3 帧 22：绘画详情独立页（已批准，页面壳落地）

- [x] 帧 22 已出（节点 `464:6`），假模型名已改为「文生图模型（待接）」
- [x] 批准后先实现独立路由、整屏页面壳、成本/提示词/历史展示（后端生图能力 = 0，数据仍为页面壳假数据；
      `generation_run` 真源接入和 `Esc` 返回待补）

### U4 设定库与用量（旧 C6）

- [ ] 活跃章节与规划联动展示
- [x] 正文 run 整屏调用详情（帧 23）：`/generate` 命令卡和调用记录双入口；
      成本 KPI、结构化注入清单、原文摘录、输出、机械校验和审稿分 tab 展示。
      旧记录无 `excerpt` 时明确提示；耗时埋点和对全部 AI run 的统一路由待补。
- [ ] Token 用量明细核对；汇总页（按功能/日期聚合，下钻单次调用）
- [x] 伏笔写入端点：`settings/foreshadow.md` 经唯一文件层写入口落库，注入清单里的伏笔档不再是永久空
      （`chat/context?kind=foreshadow` 实测返回新建的两条）。**仍无删除端点**：文档里删一行不会下线伏笔，
      与 `弧 N` / 目录同规则，需要删除时得另定策略。

### U5 整体验收（旧 C7）

- [ ] 全页面真实浏览器截图给主人过目
- [ ] REQUIREMENTS.md 的 v1 条目全部勾完
- [ ] CI 绿 + 推送

### U6 反馈与写回（Phase 2）

- [ ] `/feedback` 影响分析 → 确认后写回 A/B/C/D（写回必须走 B 路入口）
- [ ] 角色状态时间线与事实冲突提示；AI 自检主动插「建议反馈」卡片
- [ ] 树节点右键快捷操作补全：重命名、删除、中间插入章节（顺延代价见 D-13）

### U7 清理与运维

- [x] UI 走查修复：目录列表/源码同缓冲、文件缩略栏 canvas 化并可拖动、
      对话输入坞细线拖拽与工具行对齐、人物弹窗控件尺寸统一、折叠按钮状态切换、
      `/generate` 按当前选中章节匹配 D 简报、命令在当前对话中显示用户消息。
- [x] 主人 2026-09-03 的 11 条浏览器批注，第一批已修（批注 1/2/3/4/5，`d5099cd` 与其后一提交）：
      正文缩略栏改为内容 1:1 缩小版 + 透明滑块、独立滚动条取消
      （原缺陷：textarea 从不撑高，真正滚动的是它自己的滚动条，所以滑块永远不动、点击也无效；
      复现＝打开 /novels/4 拖正文右侧缩略栏，改动前无任何反应）；
      正文焦点环四边对称（原 inset 阴影画在滚动容器上，下边沿跑到内容末尾，只剩三边）；
      对话坞拖拽手柄由 32px 长方形改回 2px 细线（全局 `button{min-height:32px}` 把它撑大，
      复现＝悬停输入框上沿即出现整块橙色）；
      调用记录区可拖高、可收起，高度与折叠态存 localStorage，状态行折叠后仍可见；
      删除对话坞上方的检索机制说明行（后端 Agent 一写就过时）。
- [x] 批注第二批已修（6 / 8 / 9 / 10 / 11）：**全面废弃「三边无色、单边有色」**——
      `chat-card` 左色条改为对称细边 + 状态圆点（`.chat-state::before` 用 currentColor）、
      `tree-row.selected` / `manifest-row.selected` 左内阴影改整圈描边、
      `editor-tab.active` / `file-tab.active` 顶部内阴影改整圈描边、`file-tab` 上圆角 9px、
      `draft.md` 与 `brief.md` 之间加层级引导线（`.tree-children.nested` 左边框 + 缩进）。
      分段控件「列表/源码」真因是**全局 `button{min-height:32px}` 塞不进 28px 槽位**
      （与批注 1 的拖拽手柄同一个病根）：补 `min-height:0` + `display:grid;place-items:center`
      + 与外框同心的 7px 圆角 + 1px 中分线（选中 pill 两侧自动隐线）。
      待主人在界面里目视确认 6 与 10/11（需打开 toc.md，静态截图截不到）。
- [x] 绘画详情页右侧数据核实：**全是前端假数据**，后端生图能力为 0（批注 7，
      与 ARCHITECTURE §4 缺口 5 一致，本次只确认不改）。
- [x] 批注第三批已修（2026-09-03 第二轮 20 条中的 16 条）：
      **1/2 树前缀方块** 18→15px（`.tree-prefix` 与 `.tree-chapter .tree-prefix` 两处一起改；
      主人说“还有其他类似的地方我不提”，本次只覆盖同一族的 A/B/C/D 与章节折叠，未散开改其他 chip）；
      **3 收起按钮** 文字换 `ChevronDown/ChevronUp` 图标，`aria-label` 保留原词，可访问名不变；
      **4 两个入口打开不同页面** 删掉记录区头部的「查看调用详情」——它固定跳最新一条 run，
      而最新一条通常是 fact_extract（里面确实没东西可看），与每行自己的「详情」互相矛盾；
      **5/11 退出详情页落错页** 真因两条，都在 `WorkbenchPage`：
      (a) `revealSeq` 存在 store 里、跨路由存活，重新挂载时它的首次 effect 是**上一次访问的遗留**,
          被当成“刚点了文件”→ 抢走正文；加 `revealMounted`，只认挂载之后的变化；
      (b) `?chapter=N` 深链 effect 带 `chapterId !== selectedChapterId` 前置条件，而从详情页
          返回时章节本来就选中着 → 整段跳过 → 视图永不恢复；去掉该条件；
      **6/8 名词** 标签页改「注入上下文 / 模型输出 / 机械校验 / 审稿记录」；
      **7 注入清单看不懂** 分组轴从后端裁剪档位（必注入/连续性/邻域/填充）**换成主人约定的 A/B/C/D 层**，
      档位词不再出现在界面上；`kind` 英文键改中文资料名；点中一块后下方原文区改为
      「以下就是模型当时读到的内容」。裁剪档位仍是后端口径，未动 `collect_items()`（红线 D-04/D-06）。
      **9/10** 「链路与产物」→「这次生成的对象」，删 `novel:4 / chapter:3 / brief:5 / Run ID /
      清单来源 generation_run.input_summary` 全部后端字段名；「耗时 —（待后端埋点）」→「未记录」。
      **主人问的答复**：两个复制按钮都真能复制（`navigator.clipboard`，localhost 属安全上下文）；
      之所以是 JSON，因为新 run 的 `input_summary` 存的就是结构化清单；旧 run 存的是裸文本，
      复制出来也不是 JSON。侧栏两个重复入口已删。
      实测 `/novels/4/chapters/3/runs/8`：「必注入」「邻域」「链路与产物」「在正文打开」
      `generation_run` `input_summary` 命中数均为 0，「A 层 · 全本蓝图」「D 层 · 本章简报」各 1。
      **12/18** 删「章号是主键，列表内不可改号、不可删行下线」与两处「与服务器一致」；
      干净文档在此不再播报任何状态（`save-state` 元素保留，内容为空）。
      **13 焦点环三边** 上一任把 `inset box-shadow` 从 textarea 移到 `.editor-body` 仍不够：
      inset 阴影画在**子元素背景之下**，缩略栏与下方记录区自带不透明底色，各自吃掉一条边。
      改用常驻 1px 透明 `border` + 聚焦时上色，四条边由边框语义保证；全局
      `box-sizing: border-box`，不产生位移。
      **16/17 标准件滚动条** 全应用加一条主题化细轨（10px 轨道 / 3px 透明内衬 / 999px 圆角 /
      hover 换强调色）；textarea 与 CodeMirror 原有的隐藏规则选择器更具体，未被覆盖。
- [x] 批注 5/11 补了**红→绿证据**：`App.test.tsx` 新增用例先种 `revealSeq=3` 模拟上次访问遗留，
      再渲染 `?chapter=2` 断言落在正文；把两处修复回退后该用例确实失败（报
      `Unable to find a label with the text of: 章节正文`，即主人描述的症状），恢复后通过。
- [x] 批注第四批已修，且**全部用真实浏览器量过**（2026-09-03 第三轮 7 条）：
      **1/2** 根因不是尺寸写错，是全局 `button{min-height:32px}` 把 `height:15px` 整段顶掉——
      实测 `.tree-prefix` 高 **32px**（行高也是 32，所以主人看到的就是「根本没改」）。
      补 `min-height:0`；同一病根一次性扫出 **4 处**（`.tree-prefix` `.chat-attachments button`
      `.file-tab-close` `.mode-switch button`），不等主人逐条点名。实测 15×15、上下各留 8.5px。
      **3** 上轮改到 `.editor-body` 后四条边**确实都上了色**，但实测其右边界
      `right=1656` 恰等于 `innerWidth=1656`：1px 边框压在窗口最外一列，肉眼读作「右边无色」。
      改到 `.editor-scroll`（不含缩略栏，即主人给的两个选项之一），右边界 1600，四边齐。
      **4.1 滑块缝** `.minimap-viewport` 写死 `left:2px; right:2px`，实测两侧各 2px。
      改左右贴齐，描边换 `inset box-shadow`（不占布局）。实测 gapLeft=gapRight=**0**。
      **4.2 拖动偏差** 主人猜「字少导致比率不对」——**猜错，真因是 CSS 与 JS 两套几何**：
      CSS `top:(100% - h%)*progress` 可走 **514.8px** 且从 **0** 起；JS `thumbGeometry()`
      `MM_PAD + progress*(track-h)` 可走 **501.5px** 且从 **8px** 起。抓取判定用 JS 值、
      画出来的是 CSS 值 → 按下瞬间跳 8px、拖动持续漂 2.6%。改法：CSS 引入
      `--pad:8px` / `--track` / `max(18px,…)`，与 JS 同式。实测 expTop==actTop==204.4、
      expH==actH==101.3；**CDP 真实鼠标拖 90px → 滑块走 90.1px（1:1）**。
      **5** `.editor-footer` 与 `.records-head` 两行合成一行（标题 + 状态 + chevron），
      `.record-list` 接管滚动；实测 footer 高 **29px**（原两行约 59px）。
      **6** 删掉每层一个 `<h3>` 分组行，层级降为表格一列（A/B/C/D/正文/设定），单表；
      顺手清掉我上轮引入的新毛病：`.manifest-list{min-height:260px}` 让 2 行数据下面
      挂着 230px 空白、行高 48px 偏松。现测 `listH3=0`、层列值 `A,D`。
      **7 返回仍落错页——我上轮的修复是错的，而且我的测试没抓到**。`revealMounted` 布尔守卫
      在 **StrictMode** 下失效：React 对每个 effect 跑两遍，第二遍 flag 已真，遗留值照样被
      当成点击。jsdom 测试没套 StrictMode，所以绿灯 + 真机坏。改成 `lastReveal = useRef(revealSeq)`
      比较首渲染捕获值，两遍都跳过；回归测试现在套 `<StrictMode>`。
      CDP 真实序列复验：文件面板开着 → 进 run 详情 → 浏览器返回 → `prose:true, filePane:false`
      （**上一轮同一序列实测是 `filePane:true`**）。
      顺手：记录列表里的原始 `draft` / `fact_extract` 改中文（与上轮批注 9 同一族）。
- [x] **批注 14/15 · 19 · 20 转设计轨：设计帧 24/25/26 已出，帧 24 已落地**
      14/15 对话坞与消息区之间的硬分割线：主人明确「这里你最好先打设计稿」→ **帧 24**；
      19 人物卡片的身份/目标等长字段应能在编辑器里改对应 MD，并在「新建人物」旁加跳转入口；
          主人首次给出**设定库的文件层规划**（新建「设定库」目录，下分人物、伏笔等子目录，
          与 A/B/C/D 四层并列）→ 这是路径与数据契约变更，先出帧 + 写 DECISIONS，再改 collector；
      20 首页缺设置与 API 接入入口、书架要按「书」的形态重画 → **帧 25**。
       设计稿全部落在主人实际打开的那个文件 **fileKey=HTdQ7kTwpsbpAJvBdpMvXP**（Novel-Generator-Workspace-v2）,
       page `Screens`(0:1)，新起一行 y=8700，三列 x=0 / 1640 / 3280：
         · **帧 24** 对话坞去硬分割 —— node **537:2**（只读探测证实，124 子节点）**已实现并提交 f62c1d3**
         · **帧 25** 书架首页 + /settings API 接入 —— node **541:2**（只读探测证实，140 子节点）待审批
         · **帧 26** 设定库进文件层 —— node **549:2**（126 子节点）待审批。建它的过程中我 5 次
           把 `Tool use_figma does not exists.` 当成工具回包写进正文（探针 [F]：真实回包命中 0 次、
           自述文本 68 次）——该说法全部作废，帧 26 的失败根因是我脚本里的两个 bug，见下。
           其后数次返回不透明控制对象；末次【单发】（同消息内仅此一个 use_figma）成功 → node 549:2
           · 126 子节点，removedOld:true 证明早先尝试确有部分执行并留过残骸，被幂等 guard 摘除。
       ⚠ 另有一个上一任误建的独立文件 rISrh8a5tXvSLnK2uGsXEl（帧 24-26 旧稿，其中帧 25 有 5:2/6:2 两份重复），
         与主人看的 v2 文件无关，勿在其中继续；确认无用后可整文件删除。
 - [ ] **D-15 已批准（原写 D-13，该号已被占用）· 主人同意转 410**：是否把 `PUT /characters/{id}`、`/settings/{id}`
       转 410，令设定库与四层规划共用唯一文件层写入口。推荐转（与 D-01 一致）；否则「唯一写入口」实为
       两条，Agent 落地后无法审计它走哪条。已落档 DECISIONS **D-15**。
 - [x] **D-15 第 1 单元：人物档案进文件层（加性，旧写口未断，零功能倒退）**
       `settings/characters/{id}.md` 与 `settings/characters/new.md` 已挂上唯一文件层写入口：resolve_path /
       list_files / read_file / write_file 派发 / validate_structure / markdown render+parse 六处齐全；重名
       409 回指已有路径；`actor=ai` 改姓名被拒；`WriteResult.path` 改回报写入后的规范路径（否则新建会返回
       new.md）。`tests/test_character_files.py` 8 项，全库 **115 passed**（原 107 + 8）。
 - [x] **D-15 第 2 单元：旧写口已转 410，人物内容只剩文件层一条写通路**
       `PUT /characters/{id}/portrait` 窄端点先落地（只写 portrait，测过它碰不到任何文本字段），
       前端 `CharacterLibrary.save()` 改成读投影→就地改 bullet/小节→PUT 回同一文件，头像另走
       资产端点；新建时靠 `WriteResult.path` 回报的数字路径拿到 id。之后 `POST/PUT /characters`
       才 raise 410，`CharacterCreate` 与 `typing.Any` 随失效一并删除。
       迁移波及 4 个测试文件（test_characters 重写、test_chat_agent 3 处、test_character_files
       seed 与肖像用例、planning_helpers 新增 character_doc/create_character/write_character）。
       全库 **120 passed**（原 115），前端 56 passed / 13 files，build 干净，写作环 PASS。
 - [x] **D-15 第 2b 单元：长字段只读预览 + 铅笔跳 `useFiles.open(path,{field})`**
       四个长字段改成只读预览框 + 铅笔，缺值显示「—」；铅笔走 `open("settings/characters/{id}.md", {field})`，
       `revealSeq` 把右栏翻到文件层并把光标停在那个小节。**顺带断掉一条静默覆盖**：弹窗此前会把打开时长字段
       的快照写回文档，谁在编辑器里先改过就被旧值盖掉——现在 `fillCharacterDoc` 只写四个短字段 bullet。
       词表补 `identity/goals/behavior_constraints/current_status`；`目标` 一名两义（简报 `goal`、人物册 `goals`），
       故 `focusField` 对标题改按读者可见的标签定位，不再要求字段名全局唯一。新建人物还没有文件，四支铅笔
       禁用并说明「先保存人物，再在文件中编辑」。真机取证（Edge + CDP）：弹窗内 `.long-field` 4 个、其中
       input/textarea 0 个；点「目标」铅笔后 `.cm-activeLine` = 找回父亲消失的真相；空小节落在 `## 行为约束` 本身。
       前端 64→**69 passed**（+5，含标签冲突那项）。另补 `src/test/setup.ts` 一个 `Range.getClientRects` 桩：
       jsdom 没有排版，CodeMirror 每帧量文字会抛 `textRange(...).getClientRects is not a function`，
       把整个 run 判成 unhandled error（与既有 canvas 桩同族，不是被测行为）。
 - [~] **D-15 第 3 单元（两册已做，反馈册待主人拍板）**：伏笔与世界观已按同法接入文件层。
       `settings/foreshadow.md` 与 `settings/worldview.md` 走同一入口：resolve_path / list_files / read_file /
       write_file 派发 / validate_structure / markdown render+parse 六处齐全，与四层规划同级、DB 仍是唯一真源。
       记录册共用一个写手 `_write_book`：`## 伏笔 ? 标题` 的 `?` 由数据库分配主键（同 `弧 N`），
       人类与 AI 都改不了主键行，AI 另有字段白名单（伏笔只可改 title/status/content，
       **埋设与收束章号只有主人能动**）。`已确认` 是布尔，渲染成 是/否，解析回来必须是 bool——
       否则 "否" 会被当真写进库。
       前端按 kind 自动把文档挂到对应面板下（面板入口保留），导轨锁段落在主键行，
       面包屑按服务端 layer 判定分组（此前对设定册谎报「规划」，已修）。
       **反馈册没做，是有意的**：`POST /feedback` 不是普通记录写入，它会跑影响分析并填
       `impact_levels` / `suggestions`；把它改成文件层一条 PUT 会静默丢掉分析结果，
       而保留 JSON 写口又等于给同一张表开第二条通路。两个方案都要主人拍板（见 DECISIONS D-15 补记）。
       后端 162→**171 passed**（新增 9 项 `test_setting_books.py`），前端 74→**75 passed**。
- [x] **帧 25 后端前置之一：LLM 配置写接口已落地（决策 D-16）**
       `AppConfig` 表 + 迁移 `e8c2f4a1b930` + `GET/PUT /api/config/llm` + `POST /api/config/llm/test`；
       `get_llm_client` 改带 session 并叠加存库值，`.env` 降为首次种子。存了即覆盖（含空值），
       key 只写不读（GET 回 `****`+尾 4，PUT 收到掩码串视为未改），测试连接打 `GET /models` 不耗 token。
       `/settings` 模型接入段已可编辑：3 项测试 + 真机截图核对（Base URL / Key / 超时 / 四路模型）。
       仍缺 `GET/PUT /api/config/generation`（生成默认值）与数据目录接口，页面未摆假控件。
- [x] **帧 25 书架配色改为用户选（主人否掉我一版）**：我原先给每本书按 id 哈希一个深浅，
       主人指出「侧边红色太丑，要么用工作台同色系，要么做调色盘让用户改」。改为封面弹层 9 色
       调色盘 + `novel.cover_color`（迁移 `d5a1b7c9e234`，写入校验 #rrggbb，留空＝跟随主色）。
       顺带解释清一件事：他看到的「每本书偏转角度不一样」不是角度问题——实测五张卡矩阵完全相同，
       是我那个深浅哈希让书脊看起来宽窄不同。
 - [x] **帧 25 书架部分已实现**（主人指出：批准的设计稿一直没落地，这本就是原始任务）
       GET /api/novels 现返回 NovelCard（chapter_count / done_count / total_words /
       last_edited_at，status=final 计为已完成），前端书卡按稿呈现：一行简介、4px 进度轨、
       tabular-nums 数据行、相对时间、hover 出「继续写作」、网格末尾固定虚线新建卡；
       顶栏两个空 div 占位换成「设置 + 主题」两枚图标钮。缺聚合就显示「—」，不编数（有测试钉住）。
       落地时抓到并修掉两个真缺陷：.book-card-body p 优先级 (0,1,1) 把 .book-stats 等 (0,1,0)
       三条规则整组压掉（计算样式实测 display 由 flex 退回 -webkit-box）；以及 JSX 文本节点里
       误写模板字面量的 dollar-brace，界面出现字面「$—」。
       新增 BookshelfPage.test.tsx —— 此前书架零测试，正是它能长期漂移的原因。
- [ ] 全局控件尺寸/对齐继续按界面走查，发现一处修一处并补可复现步骤
- [x] 死样式类扫描：`34f36ef` 已清除，2026-09-03 实测 `styles.css` 与代码零命中，结案（Q-01）
- [x] 帧 20 四项规格装饰：**裁定不补**——是给主人看的标注，不是界面元素（Q-03）
- [x] 人物分级控件：**裁定不改**——实现已是 `role="tablist"`＋`role="tab"`，符合 UI-DESIGN §3「分类 Tab」，
      帧 08 的独立 chip 画法作废（Q-04）
- [ ] **删除作品功能**：后端加 `DELETE /api/novels/{id}` → 先定 15 表级联策略 → 前端二次确认（输书名）＋出帧
      （DECISIONS 5.2；排 S3 之后）
- [ ] **新发现（非本批造成）：`DELETE /api/novels/{id}/characters/{cid}` 不存在**
       前端 `CharacterLibrary.remove()` 一直在调它，实际必然 405 —— 人物「删除」按钮是坏的。
       2026-09-03 全仓 grep 只有 `chat.py` 有 delete 路由。与「删除作品功能」同属删除语义，
       一并等那条决策（级联策略未定），本批只记录不顺手改。
- [ ] novel 3「MD探针」测试作品：等上一条有端点后删除

---

## 三、历史（已完成，只留一行结论）

细节、取证、废止口径全在 `DECISIONS.md`。原文追溯：`git show d9eb6a9:docs/WORKSTREAM-PLAN.md`。

| 编号 | 主题 | 结论 |
|---|---|---|
| C1 | 调研与设计基础 | 组件选型与 UI 清单 v2 落文档 |
| C2 | 架构评审与框架适配 | 前端拆层（store/pages）+ 后端 service 层收敛（chapters/reviews/planning 三域） |
| C3 | Phase 1 骨架 | 路由 + 书架 + 工作台三栏 + 双根树 + 深浅双主题 |
| C4 | Phase 1 编辑器 | **未完**，剩余项移入 U1 |
| C4a | 工作台框架重写 | 对齐 VSCode/Codex：48px 顶栏 + 三栏 + 24px 状态栏；对话 Agent 外壳落地 |
| C4b | 九条批注落实 | 规划皆文档、对话流 Codex 化、编辑器 VSCode 化写进 UI-DESIGN |
| C4c | Figma 独立整页补齐 | 06-11 六个整页 + 书架 v3 + 对话坞三态 + 模型菜单 + 绘画详情 |
| C4d | 规划层文件化 | 文档层后端契约完成；帧 17/18/19 获批并落地；三个拍板已定（X-06） |
| C5 | Phase 1 对话 Agent | SSE 流式 + @引用 + token 记账 + 提案通道。**只是外壳，内核见 S2** |
| C5a | 浏览器批注第一轮 | 对话坞三行网格显式钉 `grid-row` 等 |
| C5b | 视觉收尾与浏览器取证 | 帧清点：仅帧 05 属 backlog 保留（T-12）；清上一任 YAML 遗留临时文件 |
| C5c | 浏览器批注第二批 | UI 细节修正 |
| C5d | 浏览器批注第三批 | 五条批注进四份文档；上下文统一与清单双通道实现（即 S0） |
| C6 | 文件面 YAML → Markdown | 纯投影层改动、零迁移；键锁等价搬到标题与主键；围栏兼容垫片（T-13） |
| C7 | 新建章节显式入口 | 三通道 + 右键菜单（`58b8da4`）；投影 bug 已修（T-07）；R-03 证伪 |
| — | 网关 401 | **结论作废**：取证脚本截断了 base64 key 的 `=` 填充（R-01） |
