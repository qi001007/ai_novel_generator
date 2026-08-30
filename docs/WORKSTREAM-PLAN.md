# 多对话分工计划书

这个项目改动量大，拆成多场对话推进。每场对话只做一个主题，避免上下文膨胀、保持效率。

**工作规则：**

1. 每场对话开始：先读本文件，找到当前对话编号和它的未勾选项。
2. 只做本场对话范围内的任务，别的发现只记录不顺手改。
3. 每完成一项就勾选；对话结束前 commit + push。
4. 需求变更先改 PRD，再同步 REQUIREMENTS.md / UI-DESIGN.md。

## 状态看板

当前进行到：C1

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

## C5 Phase 1 对话 Agent

- [ ] 后端对话 Agent 接口（独立模型配置 `NOVEL_LLM_CHAT_MODEL`）
- [ ] 上下文自动检索 + @引用解析
- [ ] 斜杠命令解析与命令面板前端
- [ ] 流式消息卡片 + 错误卡片 + 重试
- [ ] 消息级 Token 用量展开
- [ ] 测试 + 构建 + 截图验收 + 推送

## C6 Phase 1 设定库与用量收尾

- [ ] 人物分类标签页 + 搜索 + 卡片墙
- [ ] 人物详情弹层（活跃章节、弧线、关系）
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
