# frontend/src/components/ 更改账（最新在上）

- 2026-09-10 · 批次 35.3（裁定进 D-45）：`ProposalCard.tsx` 把折叠那颗钮从 `.proposal-diff` 列表**末尾**搬成独立 `fold` 节点、渲染进 `.proposal-head`（与文件名、`AI 提案 · +N −M · 第 X 行` 同一行）。原因不是状态而是几何：真机 Edge+CDP 真鼠标点「展开全部 50 行改动」后卡片 1403px、`收起` 落在 `top=1429`，而 `.chat-messages` 可视底边 `756`，控件在视口外 **673px**，主人看到的就是「展开后没法再收起」；头部在它下方长多少行都不动，复测 `moreTop` 403→403（位移 **0px**）、展开前后 `moreVisible` 均 `true`、DOM 行数 8→50→8。双向逻辑（`setShowAll((value) => !value)` + `aria-expanded`，`c978ce3` 起）一寸未改，两个分支继续共用同一份 `changeRows`。同批 `ProposalCard.test.tsx` 新增 `pins the fold control above the rows it folds (35.3)`（先红后绿），原有两条双向断言一条未删。

- 2026-09-09 · 历史加载遇到已等同当前文件的最新提案时，同时清除同路径旧待处理卡，避免导入成功后旧红字重新出现。
- 2026-09-10 · 修复提案确认过滤：所有 proposal 进入待处理状态，只有主人点击应用才写入。
- 2026-09-10 · 对话代码块启用软换行；CodeMirror 编辑器启用 lineWrapping。
- 2026-09-10 · 目录长文本单元格改为可增长换行；渲染目录覆盖编辑区（含缩略栏），避免源码底色泄露。
- 2026-09-10 · 无效提案也展示完整 diff，便于主人审查并重新生成；应用按钮仍严格禁用。
- 2026-09-10 · 对历史提案中的“内容/起止章”可纠正别名开放应用；其他结构错误继续禁用。

- 2026-09-09 · TocListView 在 B 层提案待确认期间渲染临时目录并显示状态标识；不修改文件 buffer。

- 2026-09-09 · ChatPane rows and thinking details now use a 180ms ease-out entrance animation with reduced-motion override.

- 2026-09-09 · 精简组件地图，标明三处仍未接真实数据的面板；未改源码。
- 2026-09-08 · ChatPane 展示每步成本；cmDoc 改为消费服务端 grammar；测试 fixture 不再抄标签。
- 2026-09-07 · 对话 reasoning、工具轨迹、人物文档渲染与恢复动作完成并纳入 UI 不变量。
- 2026-09-05 · 建立提案、标签栏、三栏、焦点和控件图形语言的不可回退断言。
 - 2026-09-09：在 ChatPane 工具栏加入“确认并生成”按钮，复用现有 `/generate` 命令与 `generateDraft` 流程；不新增 Agent 写工具。
