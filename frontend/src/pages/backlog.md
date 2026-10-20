# frontend/src/pages/ 更改账（最新在上）

- 2026-10-19：V-18 候选修复：设定树的世界观分组进入独立 Markdown 摘要页，点击具体文件再回到编辑器；地图库仍只由独立一级入口打开。

- 2026-10-19：三栏极端拖拽改为先按侧栏自身上限夹紧再判断编辑栏余量，避免左侧栏已停在 520px 后继续把屏外指针当作真实宽度并误收起右栏。

- 2026-10-19：模型接入页为每个供应商增加 `/models` 获取、加载/错误/成功状态和 datalist 键盘候选；Agent 预算改称“每条消息最多内部步骤”并明确不限制继续提问。

- 2026-10-19：书架按 `last_edited_at` 排序，主卡作品仍保留在“最近”列表；撤下未形成闭环的置顶/归档筛选，并补行为测试与真实侧边栏浏览器验收。
- 2026-10-18：撤回误加的启动页 `LauncherAgent`；Codex 的平台操控属于开发侧 MCP，不进入产品书架。

- 2026-10-18 · 启动页视觉收敛：保留原工作台暗色、细边框与立体书；Codex 只提供搜索、最近项目与紧凑列表的信息层级，移除主卡大渐变和胶囊状态。

- 2026-10-18 · 书架改为 Codex 项目启动器：最近作品主卡、紧凑列表、搜索/最近/置顶/归档、新建入口；工作台增加作品快速切换，Workflow 从设置移入侧栏。

- 2026-09-16：PreferencesPage 增加全局上下文工作流设置入口，画布与策略组件见 `components/ContextWorkflowPanel.tsx`。

- 2026-09-11 · 批次 35.36：`WorkbenchPage.tsx` **+1/−1**，只动 `:986` 那一处——`<ForeshadowWall novelId={...} />` → `<ForeshadowWall />`。那个 prop 在本条之后没有任何接收者（组件里它唯一的用途就是那颗假按钮的 `disabled={!novelId}`），留着就是给下一个人一个假的线索。同一块的 `:985` `<WorldMapPanel novelId={...} />` **不动**：那颗「查看绘画详情（页面壳）」还在用它拼真路由。

- 2026-09-11 · 批次 30.7 第一条：`GenerationRunDetailPage.tsx` **+8/−0**，「注入上下文」页签在 `.manifest-columns` 那道表头**之上**多一条 `.manifest-missing`：`<strong>未命中人物：{…join("、")}</strong>` ＋ 一句 `<span>` 说明，条件写成 `manifest.missing_characters?.length ? … : null`——可选链是必需的，**旧 run 落库的那份清单里根本没有这个键**，`?.` 让历史页一张脸都不变。只加不改：下面那张表怎么分组、怎么数行、怎么标「本次未交给模型」，一概未动（清单说什么由 collector 决定，页面只负责摆出来）。同目录**新建** `GenerationRunDetailPage.test.tsx`（**143 行**，本页第一份测试），stub server 覆盖 `/api/health`／`/api/novels`／`/llm/status`／章节／`generation-runs`／`planning/briefs`／`reviews`／`machine-check`，三条用例：① 有未命中 → 那句在，且用 `compareDocumentPosition` 钉它**在表头之前**（放下面就成了「某一行的备注」，语义就错了），`.manifest-row` 仍是 2 行；② `missing_characters: []` → 不出；③ 键整个不存在（旧 run）→ 不出。②③ 是两件事：一个「有值但为空」，一个「清单来自这个字段上线之前」，混成一条就会有人拿 `?? []` 顺手糊掉真问题。**真机**（副本库 `307.db`，5175→8012，`NOVEL_LLM_API_KEY=` 空、零额度、主人的库未动）：作品 1 第 42 章 run **41** → `.manifest-missing` 命中，文案「未命中人物：守碑人简报点名，人物库无同名卡，本窗未注入」，几何 `x=21 y=262 w=1244 h=37`，`bg=rgb(251,243,226)`／`color=rgb(138,106,18)`／`12px`，`beforeColumns=true`（表头 top 299、首行 top 332），`.manifest-row` **12** 行未变；对照 run **12**（旧清单、无此键）→ `hasMissing=false`、`.manifest-row` 5 行。图 `probe/307-run41.png`／`307-run12.png`，两张都自己看过：暖色那一条压在表头上方、横跨整表宽度，读起来是「对这张表的一句说明」，不是第 13 行。
- 2026-09-10 · 批次 35.9（D-42）：PreferencesPage 在「任务路由」之后新增「对话 Agent 预算」分组——两个数字框（单轮最多几轮 1–20、单轮 token 上限 1000–1000000），值从 `/api/config/llm` 读回、随原有那个保存按钮走同一条 PUT，框清空即 `null`、服务端保持原值。说明文字写明出厂 `6 / 60000` 是按「读 3 个文件 + 出 1 个提案」的一轮实测给的，并承诺到上限时停下说明用了多少、不把截断内容当回答。
- 2026-09-09 · 更新四个路由页的职责说明；未改源码。
- 2026-09-07 · WorkbenchPage 接章号动作、历史对话及栏面/文件恢复；PreferencesPage 接整章恢复。
- 2026-09-06 · BookshelfPage 接作品编辑、导出与删除；PreferencesPage 完成模型和外观设置。
