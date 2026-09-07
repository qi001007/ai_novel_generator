# frontend/ —— 前端（React 19 + Vite + zustand 单页）

**往下看**：`src/` 根（入口与跨面单件，含 `api.ts` 这条唯一网络边界）→ `src/components/`
一块一面 → `src/pages/` 路由级页面 → `src/store/` 三个状态持有者 → `src/utils/` 纯函数。
**每层各有 description.md，细节往下读。**

**看什么再动手**：`docs/UI-DESIGN.md` §0 令牌、§0.7 控件纪律、§0.8 动作图形语言、
**§0.9 不可回退清单**（改任何界面必读；改完必须同批改 `src/uiInvariants.test.ts`，不许删断言）。

**三条本机事实**：
- `#root` 上有 zoom，指针像素 ≠ CSS 像素：任何把指针当坐标的地方必须过 `toCssPx()`。
- `main.tsx` 套 StrictMode，每个 effect 跑两遍：「布尔 flag 忽略首次」真机必失效，
  正确写法是把首渲染值存 `useRef`、只对变化起反应。
- jsdom 不解析样式表：样式对不对只有真机截图看得出来（取证通道见 `AGENTS.md`）。

**怎么跑** `npm.cmd run dev`（:5173）；**怎么测** `npm run test -- --run` 加
`npx tsc -b --force --pretty false` 与 `npm run build` 都必须 clean。
**改完这里的东西**：在 `frontend/backlog.md` 追加一行。
