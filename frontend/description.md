# frontend/ —— 前端

**这里放什么**：React 19 + Vite + zustand 单页。`src/api.ts` 是唯一的网络边界
（要脱离后端就在同一接口下加 fixture 实现，不许绕过它另发 fetch：D-07）。
`src/store/` 三个 store：`workbench`（书 / 章 / 线程）、`files`（文件层缓冲）、
`appearance`（本机偏好，存 localStorage，不进库：D-21）。
`src/pages/WorkbenchPage.tsx` 是三栏工作台，`src/components/TreePane.tsx` 是左栏树。

**看什么再动手**：`docs/UI-DESIGN.md` §0 令牌、§0.7 控件纪律、§0.8 动作图形语言、
**§0.9 不可回退清单**（改任何界面之前必读；改完必须同批改 `src/uiInvariants.test.ts`）。

**三条本机事实**：
- `#root` 上有 zoom：指针像素不等于 CSS 像素，任何把指针当坐标的地方必须过 `toCssPx()`。
- `main.tsx` 套了 StrictMode，每个 effect 跑两遍：用「布尔 flag 忽略首次」的写法
  真机上必然失效，正确写法是把首渲染的值存进 `useRef`、只对变化起反应。
- jsdom 不解析样式表：样式对不对只有真机截图看得出来（见 `AGENTS.md`《前端取证通道》）。

**怎么跑**：`npm.cmd run dev`（:5173）。
**怎么测**：`npm run test -- --run`，另外 `npx tsc -b --force --pretty false` 与
`npm run build` 都必须 clean。

**改完这里的东西**：在 `frontend/backlog.md` 追加一行。

