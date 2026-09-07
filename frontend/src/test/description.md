# src/test/ —— 只给测试用的地基（两个文件）

- `setup.ts`：vitest 全局前置，`vite.config.ts` 的 `setupFiles` 指向它。
- `servedGrammar.ts`：把后端 `markdown_doc.py` 里的语法表**解析**成投影会给出的 JSON。
  为什么要有它（候选 4c）：前端的本地表已删，组件测试的 fixture 若自己抄一份标签，
  就等于立第三把表——4a 那次漂移（世界观/伏笔墙标签前端零命中）正是抄出来的。
  解析规则与后端 `grammar_for_kind()` 一致：元组名后缀定 role，`_GRAMMAR` 定 kind 用哪几张。
  两个坑写在该文件注释里，都在本机咬过人：单行元组（`_TOC_BULLETS`）不认就整张静默漏检；
  本机 `core.autocrlf=true` 让 node 读到 CRLF，不归一就正则空跑成绿灯。

产品代码不许 import 本目录（这里的一切只在测试里跑）。
