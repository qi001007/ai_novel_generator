# frontend/ —— React 18 + Vite 单页应用

向下读取：src/ 放入口和跨面单件；components/ 放可复用界面；pages/ 放路由页；
store/ 只有 workbench、files、appearance 三个持有者；utils/ 放纯函数；test/ 放测试地基。

api.ts 是唯一网络边界。界面决定看 docs/UI-DESIGN.md，改界面同批更新 uiInvariants.test.ts，
并用真浏览器截图验证。启动与完整门禁见 docs/HANDOFF.md。
