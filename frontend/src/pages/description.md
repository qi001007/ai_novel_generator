# src/pages/ —— 路由级页面

`BookshelfPage`（书架 + 新建向导 + 删书确认）、`WorkbenchPage`（三栏工作台：树 / 对话 / 文件）、
`PreferencesPage`（模型接入 + 外观 + 「导出与恢复」那一栏）、
`GenerationRunDetailPage`（单次调用详情）。每页一份同名 `.test.tsx`；
`WorkbenchLayout.test.tsx` 钉的是栏宽与方向键的**算式**而不是字面量（默认值一变，
绑死数字会以错误的原因失败）。

**这里不放**：可复用的一块（去 `components/`）；也不直接发请求（走 `../api.ts`）。
