# frontend/src/store/ —— 三个状态持有者

workbench.ts 持有当前作品、章节、线程和业务动作；files.ts 持有打开文件、buffer、view 与 metadata；
appearance.ts 持有 localStorage 外观偏好并写 html 属性。

后端可派生的数据不在 store 复制；新增第四个 store 前必须证明这三处无法承载。
跨 await 写状态前重新读取当前 store，避免切书竞态。
