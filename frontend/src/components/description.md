# frontend/src/components/ —— 可复用界面单元

TreePane、ChatPane、EditorPane/FileEditorPane 是三栏主体；CharacterFormCard 同时服务人物弹窗与文档渲染。
chatRows/chatTrace 负责流事件转可见行；cmDoc 负责 CodeMirror 文档结构；minimap 负责正文缩略栏。
ProposalCard、FeedbackPanel、TocListView、ViewToggle、Splitter、HScrollThumb 等只管单一交互。

投影语法只读服务端 grammar；请求只走 ../api.ts；样式只写 ../styles.css。
ForeshadowWall、WorldMapPanel、PaintingDetailPanel 仍有未接真实数据的部分，见 UI-BACKLOG。
