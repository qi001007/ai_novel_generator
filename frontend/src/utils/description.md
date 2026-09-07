# src/utils/ —— 只放纯函数

目前只有 `lineDiff.ts` 和 `time.ts`（`formatTime`：NaN 给破折号，其余 zh-CN 24 小时制）：行级 diff，给「逐处接受 / 拒绝」那类界面用（那个界面本身还没做，
函数先在）。**门槛**：不碰 React、不碰网络、不碰 DOM。一旦需要 `useState` 或发请求，
它就属于 `components/` 或 `api.ts`，不该留在这里。
