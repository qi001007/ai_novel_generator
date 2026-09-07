# frontend/src/ —— 前端根：入口 + 跨面单件

- `api.ts` 是**唯一的网络边界**（D-07：要脱离后端就在同一接口下加 fixture 实现，不许另发 fetch）。
  失败也从这里统一抛出：`ApiFailure` 带 `status` 与机器码 `code`，判类型用 `errorCode(cause)`，**不许再去匹配后端那句中文**（候选 3，2026-09-07）。
- `main.tsx` 挂载并**套了 StrictMode**；`App.tsx` 是路由壳；`types.ts` 与后端字段对齐。
- `styles.css` 全仓样式都在这一个文件里（组件里不写内联样式）。
- `contextLayers.ts` 把注入清单解析成 A/B/C/D 四层；`menuPlacement.ts` 算右键菜单落点。
- `uiInvariants.test.ts` 是 `docs/UI-DESIGN.md §0.9` 不可回退清单的**机器版**。
- `labels.ts` 是 `kind`/`task` 界面词的**唯一**主人（A 层叫「全书蓝图」，D-34）；`utils/time.ts` 拥有 `formatTime`。
- `test/setup.ts` 是 vitest 脚手架（一个文件，不单列目录说明）。

**往下读**：`components/`（一块一面）、`pages/`（路由级页面）、`store/`（三个持有者）、
`utils/`（纯函数），各有一份 description.md。
