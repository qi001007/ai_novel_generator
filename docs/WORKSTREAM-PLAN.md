# 多对话分工计划书

这个项目改动量大，拆成多场对话推进。每场对话只做一个主题，避免上下文膨胀、保持效率。

**工作规则：**

1. 每场对话开始：先读本文件，找到当前对话编号和它的未勾选项。
2. 只做本场对话范围内的任务，别的发现只记录不顺手改。
3. 每完成一项就勾选；对话结束前 commit + push。
4. 需求变更先改 PRD，再同步 REQUIREMENTS.md / UI-DESIGN.md。

## 状态看板

当前进行到：C4d 前端文件编辑器 + AI 提案卡 + B→D 跳转已落地并出真实浏览器截图；C5a 四项重做全部收口

## C1 调研与设计基础（设计参考 → 清单 → Figma）

- [x] 调研 Codex / VSCode 交互范式与可复用开源组件（命令面板、树、Diff、编辑器）
- [x] 调研同类 AI 写作产品 UI（show-me-the-story、goink、SillyTavern 等）
- [x] 调研结论写入 REQUIREMENTS.md（组件库选型）与 UI-DESIGN.md（交互细节与参考）
- [x] UI 清单重写为 v2 最终版：设计令牌 + 每页框架/功能点/按钮/风格/交互五段 + 全场景状态表 + 交付前检查链
- [ ] Figma 新建设计文件，按 UI 清单 v2 逐页生成设计，每页记录链接（已建文件与书架首版；Starter 计划 20 次/月 MCP 限额 8/31 已用尽，9/1 额度重置后按 v2 清单补齐：设定库树行、对话流、编辑器细节、人物卡片页，并重绘书架/工作台以符合新令牌）
- [ ] commit + push

## C2 架构评审与框架适配（improve-codebase-architecture）

- [x] 前端结构扫描：App.tsx 单体 → 页面/组件/状态分层方案
- [x] 后端模块深度审查（路由/服务/模型分层是否有浅模块）
- [x] 生成 HTML 架构评审报告（临时目录，不入库）：4 个候选，首选 = 前端拆层
- [x] 主人挑选候选（选了候选 1 前端拆层）
- [x] 实施选定重构第一阶段：zustand store（store/workbench.ts 承载全部状态与动作）+ pages/（BookshelfPage、WorkbenchPage）+ App.tsx 瘦身为视图开关；前端测试 5/5 与构建通过
- [x] 后端 service 层重构第一阶段：chapters 域业务逻辑沉入 services/chapters.py（机械校验纯函数 + 生成流水线 + 章节重复校验），路由瘦身为参数解析与错误映射；后端 pytest 37/37
- [x] 后端 service 层扩展到 reviews 域：七维校验收敛为单一 validate_ai_review_payload（消除两处重复），auto_review_chapter / record_final_review / list_reviews 全部入 service；后端 pytest 37/37
- [x] 后端 service 层扩展到 planning 域：get_owned_or_error / ensure_chapter_number_unique / validate_arc_range / apply_payload / save 五个通用助手收敛 8 个端点的复制粘贴，错误文案逐一对齐；后端 pytest 37/37。C2 完成

## C3 Phase 1 骨架：路由 + 书架首页 + 工作台三栏

- [x] 前端引入路由（react-router：书架 `/`、工作台 `/novels/:id`，store 的 view 状态移除）
- [x] 书架首页：封面卡片墙 + 新建作品向导（三步）+ 空状态
- [x] 工作台双根树组件第一版（TreePane：规划 A/B/C/D + 章节行带徽章 + 设定库分组；react-arborist 升级与拖拽排序随对话流改造推进）
- [x] 深浅双主题（v2 令牌接入既有 CSS 变量 + `[data-theme="dark"]` + 跟随系统 + 手动切换持久化）
- [x] 状态徽章中文化组件（StatusBadge：草稿/已生成/AI 已审/定稿）
- [x] 测试 + 构建 + 截图验收（书架页与工作台页真实数据截图通过）+ 推送

## C4 Phase 1 编辑器

- [ ] TipTap 引入与正文编辑基础
- [ ] 自动保存 + 保存状态指示
- [ ] Ctrl+F 查找条
- [ ] 双栏对照生成（/generate 触发，流式，逐段合并）
- [ ] 选区修改（浮动工具条 → Diff → 逐处接受/拒绝）
- [ ] 内联审稿（高亮锚点 + 批注气泡 + 七维报告抽屉）
- [ ] 版本历史侧栏
- [ ] 测试 + 构建 + 截图验收 + 推送

## C4a 工作台框架重写（主人裁定：对齐 VSCode / Codex）

- [x] UI-DESIGN.md 升级 v2.1：默认布局（280px 树 + minmax(400px,34%) 对话 + 自适应右栏）、树节点打开规则、人物卡片库页面级视图写入绑定决策
- [x] WorkbenchPage 重写：48px 顶栏（返回/书名/Ctrl+K 占位/模型状态/设置/主题）+ 三栏工作区 + 24px 状态栏，面板间 1px 分隔、内部滚动
- [x] TreePane v2：双根折叠树（规划 A/B/C 前缀徽标 + 章节列表 + 设定库），A/B/C → 右栏规划编辑器，D → 编辑器，人物 → 中+右栏合并卡片库
- [x] ChatPane：Codex 式消息流（用户气泡 / Agent 卡 / 命令卡），斜杠命令 /generate /review /check /summary /save 直连真实后端流水线，运行中 spinner + 秒数，LLM 未配置提示条
- [x] EditorPane：章节页签（未保存实心点）+ 工具栏（状态徽章/六操作）+ 衬线 17px/1.9 正文（页宽 720）+ 保存状态行（aria-live）+ 机械校验卡 + 生成/审稿记录；Ctrl+S 保存、dirty 时 beforeunload 拦截
- [x] CharacterLibrary：分级 Tab（全部/主角团/重要配角/小 Boss/龙套）+ 搜索 + 卡片墙（头像色块/级别色带/活跃章节/一句话身份）+ 900px 详情弹层（左档案右字段，保存/两步删除/Esc 关闭）
- [x] 三道设计检查：ui-ux-pro-max（焦点环规则核对通过）；make-interfaces-feel-better（0.96 按压、tabular-nums、无 transition:all、reduced-motion、图标按钮 40px）；vercel web-guidelines 全量对照并修复（焦点替代、overscroll-behavior、aria-live、beforeunload、占位符 …、autoComplete）
- [x] 前端测试 5/5 + vite build 通过 + 运行时截图验收（workbench-new.png）
- [ ] Figma 重绘工作台与人物卡片库两帧（MCP Starter 限额阻塞，额度恢复后按 v2.1 补齐并与实现比对）
- [ ] 编辑器后续（归入 C4 剩余）：TipTap、Ctrl+F、双栏对照、选区 Diff、审稿抽屉、版本历史
- [x] 对话 Agent 后续（C5 已落地）：真实 LLM 流式、@引用候选与解析
- [ ] Ctrl+K 全局命令面板（仍待做）

## C4b 九条批注落实（前端先行，后端后接）

- [x] UI-DESIGN.md 升级 v3：规划皆文档范式、对话流 Codex 化五条、编辑器 VSCode 化四条（全量快捷键表）、设定库补全页（世界观/地图绘画详情页、伏笔）、人物卡修复规范
- [x] PlanningPanel A 全书蓝图 → 文档式编辑（版本 chip + 五个章节段自由文本，衬线字体）；B 目录 → 树形列表（行内改名即存 PUT + 点击章节加载详情文档区）
- [x] ChatPane Codex 化第一轮：计划/写作模式分段控件、模型 pill（读 /api/llm/status）、附件按钮（C5 接入占位）、用户/Agent 头像消息流（墨印样式）
- [x] EditorPane 加 minimap 缩略滑轨（行宽映射 + 点击跳转 + 滚动联动 thumb）
- [x] 测试 5/5 + build 通过 + 运行时截图验收（workbench-v3.png）
- [x] Figma 设计稿第一批完成（主人已开通 Pro 套餐）：`HTdQ7kTwpsbpAJvBdpMvXP` — 02 工作台 v3（id 21:26，树/头像对话坞/模式切换/模型 pill/minimap 编辑器）、03 人物卡片库+详情弹层（33:26）、04 规划文档页 A 文档式+B 目录树（34:26）、05 框选工具条+双栏修改页（35:26）
- [ ] Figma 第二批（归入 C4c 统一推进）
- [ ] 框选 → AI 修改 → 双栏对照页（等 Figma 稿与 C5 修改接口，UI 壳可先做）
- [ ] Ctrl+F 查找条与全量快捷键接线（随 TipTap 编辑器迁移一起做）
- [x] 反馈时间线页（替代现 FeedbackPanel）· AI 自检主动提示设定冲突归 C5
- [x] 世界观/地图/伏笔页面壳与空态

## C4c Figma 独立整页补齐（本对话）

- [x] A 全书蓝图整页（06 A 全书蓝图整页）
- [x] B 目录整页（07 B 目录整页）
- [x] 人物整页（08 人物整页）
- [x] 反馈时间线（09 反馈时间线）
- [x] 世界观地图（10 世界观地图）
- [x] 伏笔墙（11 伏笔墙）
- [x] 书架 v3（hover 更换封面入口 + 封面编辑弹层）
- [x] 对话坞三态
- [x] 模型菜单
- [x] 绘画详情页
- [ ] 主人逐批审批截图
- [x] 模型菜单 + 书架 v3 更换封面 + 反馈时间线：前端实现 + 测试 5/5 + 后端 37/37 + build + commit + push
- [x] 绘画详情页页面壳 + 测试 5/5 + build + commit + push
- [x] A 蓝图整页文档式编辑器（锚点导航 + 衬线正文）+ 测试 5/5 + build + commit + push
- [x] B 目录整页双栏编辑器（左侧章节列表 + 右侧文档式详情）+ 测试 5/5 + build + commit + push
- [ ] 批准后其余整页前端实现 + 测试 + 构建 + 截图 + commit + push

## C5 Phase 1 对话 Agent

- [x] 后端对话 Agent 接口（独立模型配置 `NOVEL_LLM_CHAT_MODEL`）：`services/chat.py` + `routers/chat.py`，
      SSE 事件 context/delta/done/error/end；生成器自带 Session，避开 FastAPI yield 依赖提前关闭 session 的坑
- [x] 上下文自动检索 + @引用解析：`services/context.py`，`@类型:名称`/`@章节号` 可解析，
      未识别项回写提示词；`/chat/context` 供候选列表，`ContextItem.mention` 保证候选插入即可解析
- [x] 斜杠命令解析与命令面板前端：补 `/plan A|B|C|D`（切计划模式并盘点该层）与 `/feedback <文本>`（写时间线）
- [x] 流式消息卡片 + 错误卡片 + 重试：计划模式禁正文、temperature 0.2/0.7；失败可原位重试，流式中可停止
- [x] 消息级 Token 用量展开：`ChatMessage.token_*`（消息级）+ `GenerationRun(task_type="chat")`（用量汇总）
- [x] 封面持久化收口：`PUT /api/novels/{id}` + 书架弹层 base64 上传真保存
- [x] 测试 + 构建：后端 60/60、前端 8/8、`npm run build` 通过；真接口冒烟经 :8000 与 Vite :5173 双路径确认逐字增量、落库与流一致
- [ ] 全页截图验收：浏览器驱动走 in-app Browser 的 Edge 绑定（见 C5b 取证通道更正），C7 统一补齐各页

## C5a 主人浏览器批注修复（本轮）

- [x] 1 新建作品进工作台后对话坞撑满整栏：`.chat-pane` 三行网格被条件渲染的提示条挤位，
      改为显式钉住 `grid-row`（notice=1 / messages=2 / dock=3）
- [x] 2 人物卡片没有贴照片入口：`Character.portrait` 字段 + 迁移 `b4f0d2a8c61e` +
      详情弹层头像即上传（data URL，>2MB 拒绝、可移除），卡片与弹层同时显示照片
- [x] 3 三栏不能拖拽：新增 `Splitter`（role=separator，指针拖拽 + 方向键 16px + Home 复位），
      列宽与折叠状态存 localStorage，默认值按 UI-DESIGN.md 的 280px / minmax(400px, 34%)
- [x] 4 「缩小栏不是 VSCode 风格」：缩略栏改为固定 3px 行高（超出列高才压缩）、
      视口块按 scrollTop/scrollHeight 1:1 映射、可点击可擦洗、透明底悬停提亮，去掉描边卡片感
- [x] 2026-09-02 重做收口：② 人物卡按帧 08 重排（头像 40px 与姓名/章节/徽章同行、身份独占一行、
      级别色改由徽章承载，去掉未经批准的 3px 顶边带），照片就贴在同一个头像位；详情弹层的上传入口
      从"点头像猜"改成显式的「贴照片 / 更换照片 / 移除」按钮 + 2MB 提示；
      ③ 对话坞按帧 14 重排（输入行在上、模式与模型行在下，坞实测 105px），上下文小字移出坞体
      改放坞上方（UI-DESIGN 3.1.6），发送键收进输入行内 28px
- [x] 顺带修掉两个自找的问题：`useMemo` 落在 `if (!chapter) return` 之后导致 hook 顺序漂移白屏
      （已补 EditorPane 空态→有稿的回归测试）；滚动回调每像素重建 state（改为比值不变则跳过）
- [x] 验证：后端 62/62、前端 15/15、`npm run build` 干净；Edge headless 实截
      c5-fix-dock.png / c5-fix-panes-dark.png / c5-minimap-long.png 逐项目视确认
- [ ] 待主人确认：「缩小栏」若另有所指（例如编辑器页签栏或缩放控件），本轮按缩略栏理解并已重做
- [ ] 已知偏差待批：人物页工具行的分级 Tab 仍是分段控件，帧 08 画的是各自独立的 chip（未列入本轮重做项，暂未改）

## C4d 规划层文件化（主人批注：要 VSCode 式文件编辑，不是集成 UI）

后端契约已完成并验证，前端待 mock 审批后动工。

- [x] 文档层 `services/documents.py`：四层规划投影成可编辑 YAML 文件，DB 仍是唯一真源
      - `blueprint.yaml`（A）/ `toc.yaml`（B，一条一章）/ `arcs.yaml`（C）/ `briefs/00NN.yaml`（D，每章一个文件）
      - 多行中文用块标量 `|-` 渲染，短量列表内联，读起来就是文件本体而不是表单
- [x] 键锁规则：键名与主键是结构，值才是内容
      - 任何写入者：键名增删改名一律 422；`chapter` 必须等于文件名章号
      - `actor=ai`：额外只允许改白名单字段（A 五个 / B title·plot_function·notes /
        C title·objective·conflict·resolution·status / D 除 chapter·arc 外全部），
        条目增删与 arc 归属变更直接拒收
      - `actor=human`：可增删目录条目（消失的行置 is_active=false，不物理删）
- [x] 乐观并发：读文件返回 `revision`（渲染文本 sha1），写入可带 `base_revision`，不一致 409
- [x] 路由 `routers/documents.py`：`GET /api/novels/{id}/files`、`GET|PUT /api/novels/{id}/files/{path}`
- [x] AI 写文件通道：对话回复里的 ```yaml @路径 代码块 → SSE 新增 `proposal` 事件（含 path/text/valid/error），
      主人点「应用」才以 `actor=ai` 写入；system prompt 已教会该格式与「只改值」约束
- [x] 测试：`tests/test_documents.py` 14 项 + 提案 3 项，后端 79/79
- [x] Figma 帧 17/18/19 已画完并获批（`155:252` / `286:2` / `286:162`）
      - 17 文件编辑器 · A 蓝图：VSCode 式标签 + 行号 + 键锁竖条 + 当前行 + minimap + 状态栏
      - 18 AI 提案 diff · 应用前：对话里的提案卡（红删绿增 + 应用/丢弃），编辑器第 18 行 amber 待应用带，保存禁用
      - 19 B→D 跳转定位：点目录里的描述 → 打开 `briefs/0043.yaml`，跳转来源条 + 光标落在 goal
      - 更正：上一轮记的「use_figma 不可用」是错的，工具与画板写入均正常，帧已落盘
- [x] 前端文件编辑器 + B→D 跳转（帧 17/18/19 全部落地）：
      - `src/utils/lineDiff.ts` 前后缀裁剪式行 diff；`src/store/files.ts` zustand 文件层
        （metas/tabs/active/entries/pending/jump/focus/revealSeq + attach/open/save/offer/apply）
      - `src/components/cmYaml.ts` CodeMirror 6 扩展：2px 锁条 rail、键名朱砂、提案 amber 行带、
        toc 描述可跳转标记、minimap 与光标/滚动回报
      - `src/components/FileEditorPane.tsx` 标签条 + file-bar + jump-bar + minimap + 15px 页脚 + 409 冲突条 + Ctrl+S
      - `src/components/ProposalCard.tsx` 帧 18 提案卡（红删绿增 + 应用/丢弃/在编辑器中打开），
        渲染位置在 Agent 正文之下（本轮修正：原先误嵌进消息卡 header）
      - toc.yaml 里可跳转的描述改为**常驻点状下划线**（原来只有 hover 才变样），帧 19 的落点因此可见
- [x] 拍板 1 已定：B→D 字段映射跳转 `plot_function→goal`、`notes→events`（不动后端、不丢数据）
- [x] 拍板 2 已定：编辑器组件用 CodeMirror 6（`codemirror@6.0.2` + state/view/language/commands/lang-yaml/lint）
- [x] 拍板 3 已定：D 层在左树就是文件节点 `briefs/00NN.yaml`，不是表单节点
- [x] 左树补 D 层入口：帧 17/19 已画成 `单章简报 / briefs/` + `0042.yaml` + `0043.yaml` 文件节点

## C6 Phase 1 设定库与用量收尾

- [x] 人物分类标签页 + 搜索 + 卡片墙（C4a 提前完成）
- [x] 人物详情弹层（活跃章节、档案字段；关系/弧线页签随 C6 继续）
- [ ] 活跃章节与规划联动展示
- [ ] Token 用量明细记录（后端）核对
- [ ] 测试 + 构建 + 截图验收 + 推送

## C7 Phase 1 整体验收

- [ ] 全量测试（后端 pytest / 前端 Vitest / build）
- [ ] 全页面 Playwright 截图给主人过目
- [ ] REQUIREMENTS.md v1 条目全部勾完
- [ ] CI 绿 + 推送

## C8+ Phase 2（后续排期）

- /feedback 影响分析与写回 A/B/C/D
- 设定库完整管理（世界观/伏笔/地点/阵营）
- 独立地图页与 AI 生图
- Token 用量汇总页
- 树节点右键快捷操作

## C5b 视觉收尾与真实浏览器取证（2026-09-02 本轮）

- [x] C5a 四项重做全部收口（① 1px 发丝线 ④ 帧 17 minimap 上一轮已完成；② 人物卡贴照片
      ③ 对话坞高度本轮完成），只批准帧的形状，不批准自创的控件样式
- [x] 后端 `services/documents.py` 新增 `validate_structure(path, text)`：解析 + 逐条键名集合校验；
      `services/chat.py` 的 proposal `valid` 从"只校验路径"改成真校验结构，
      模型乱改键名（mainline/theme/core_conflict 之类）不再被标成 valid=True（原先点开应用必 422）
      + 回归测试 `test_proposal_that_renames_keys_is_flagged`
- [x] 取证通道更正（主人指出后整改）：上一轮为了截图方便，往产品代码里塞了 5 个 DEV-only
      深链（`?view=characters` `?char=` `?jump=` `?demo=proposal` `?theme=dark`），属"没要求的东西"，
      **本轮全部拆除**；`?file=xxx.yaml` 是正式功能深链，保留。
- [x] 改用真实浏览器驱动取证：`mcp__chrome_devtools__*` 在本机确实不可用（硬编码找 5 个 Chrome
      路径，本机只有 Edge），但**不等于没有浏览器控制能力** —— in-app Browser 插件的 Edge 绑定可用：
      `setupBrowserRuntime()` → `agent.browsers.get("edge")` → `tab.goto/playwright.locator(...).click()/screenshot()`，
      帧 19 跳转、帧 18 提案、人物卡与弹层、深浅双主题均为真点击 + 真 LLM 回复后的截图
- [x] 验证：后端 pytest 80/80、前端 Vitest 40/40（新增坞行序与人物卡结构两条回归）、`npm run build` 干净
      （591KB chunk 警告来自 CodeMirror，非错误）
- [x] 清理：删除上一任遗留的 `_yaml_dump.txt`、`backend/_frames_yaml.txt`
- [x] `AGENTS.md` 的「Figma / MCP 故障分流」一节为主人本人添加，随本轮正常入库
- [x] Figma 过时稿清理：删掉 **帧 06 A 全书蓝图整页（`53:26`）+ 帧 07 B 目录整页（`59:26`）**，
      `Screens` 页 16 帧 → 14 帧。判据是 C4d 标题里主人本人的批注"要 VSCode 式文件编辑，不是集成 UI"，
      这两帧正是被帧 17 文件编辑器取代的集成表单页；删除前已导出 PNG 留档
      （`figma-archive/frame-06-A-blueprint.png`、`frame-07-B-toc.png`），Figma 版本历史亦可回滚。
      其余 14 帧全部仍在使用（帧 05 框选双栏是 REQUIREMENTS 里未做的 v1 选区修改，保留）
- [ ] 待主人裁定：`AGENTS.md.bak-20260902`、未跟踪的 `docs/HANDOFF.md` 如何处理；
      真库人物 沈曜（id=1）身上那张演示照片是否清掉

## 真实浏览器取证时新发现（2026-09-02，均未动代码，等主人裁定）

1. **深色主题禁用态对比度不足**：`e-dark.png` 与裁图 `e-dark-crop.png` 显示
   `保存 / 机械校验 / AI 自检 / 通过终审 / 打回` 这排禁用按钮，以及右栏顶部的章节选择器，
   是"灰底灰字"，几乎读不出来；同一屏的 `草稿` `事实落库` 与正文对比度正常。
   根因方向：禁用态用的是写死的中性灰，没跟着 `data-theme="dark"` 的 token 走。
   批准范围外（批准的帧都是浅色），故只报不改。
2. **提案卡活不过刷新**：真跑一轮 MiniMax-M2.5 出了合法提案（`+10 -20`、可应用），
   但 `fromHistory()` 只重建文本气泡、不重建 `proposals`，刷新后 `.proposal` 与 `.pending-dot` 双双归零，
   一键「应用」丢失，只剩对话里那段 yaml。等于核心闭环"AI 提案 → 点一下写回"在刷新后断掉。
3. **模型会顺手重排整份文件**：我只要求改 constraints 第二条，模型回的是整份 blueprint.yaml，
   键序与折行都变了（提案因此 30 行改动而非 1 行）。键锁校验挡住了改键名，但挡不住重排。
   可选处置：system prompt 里加"除目标值外逐字节保持原样"，或提案卡对纯折行变化做归并显示。
4. **帧 06/07 已删但表单视图还在代码里**：`PlanningPanel.tsx` 仍可经左树 `A/B/C` 前缀徽章进入。
   要么按 C4d 收掉这条入口，要么在 UI-DESIGN.md 里写明它是保留的备用视图。

## Figma MCP 实况（更正记录口径）

Figma MCP **可用**，但本会话观察到工具**间歇性从工具集里消失**（同一轮有、下一轮没了），
`use_figma` 偶发返回空壳 `{"safeToRetryWithoutCanvasRead":true}`、`get_screenshot` 偶发
`maxDimension: expected number, received string`。处置 = 重试或改用导出图核对，
不得据此写"Figma 不可用"，也不要为此改代码。真正需要修的仍是 github MCP 的过期 PAT。
