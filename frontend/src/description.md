# frontend/src/ —— 前端入口与跨面单件

main.tsx 在 StrictMode 挂载；App.tsx 管路由；api.ts 是唯一 fetch；types.ts 对齐后端字段；
styles.css 持有全站 CSS；labels.ts 持有 kind/task 文案。

contextLayers.ts 聚合注入清单；paneLayout.ts 管三栏几何；menuPlacement.ts 管菜单落点；
uiInvariants.test.ts 是 UI-DESIGN §0.9 的机器保护；grammarParity.test.ts 防投影语法复制。

大文件不做整仓重排，功能触及时再精准拆分。
