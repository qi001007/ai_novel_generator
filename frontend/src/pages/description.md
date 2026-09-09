# frontend/src/pages/ —— 路由级页面

BookshelfPage 管书架与作品动作；WorkbenchPage 组装三栏、恢复栏面与深链；
PreferencesPage 管模型、外观、导出与恢复；GenerationRunDetailPage 管单次 AI 调用详情。

页面负责布局与组合，不直接 fetch，不复制组件逻辑。行为测试同目录并置；
栏宽与恢复测试钉算法和用户意图，不钉易漂移的源码字面量。
