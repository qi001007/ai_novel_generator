# frontend\src\components/ 更改账（最新在上）

- 2026-09-07 · 候选 4c：`cmDoc.ts` 删掉 `FIELD_LABEL`/`HEADING_FIELDS`/`BULLET_FIELDS` 三张本地表，
  改吃投影随文档发来的 `grammar`——新增 `grammarOf()`（`{role:[{field,label}]}` → 本 kind 的
  三向索引：标题标签→字段、项标签→字段、字段→标签）与 `fieldOf()`（键行是人在敲的文本，只认 own property）；
  `scanDoc` 从 config 里的表查字段，**`focusField` 去掉「同名标签兜底」那段歧义补丁，只按字段精确匹配**；
  为测试导出 `scanDoc`/`DocEntry`/`grammarOf`。`FileEditorPane.tsx`：import 换成 `grammarOf`、
  `setDocConfig` 多传一项 `grammar`（useMemo，随投影 doc 变）、面包屑改成查**来源文档**自己那张表
  （新常量 `jumpLabel`，避免 JSX 换行吞掉「· 」后的空格）。三处标签撞车自此按 kind 各自解开：
  简报 `goal`／人物 `goals`，弧 `start_chapter|end_chapter`／人物 `expected_start_chapter|expected_end_chapter`。
  同批：`grammarParity.test.ts` 4 条 → 10 条（新增「前端不许有第二把表」静态扫 + 按 kind 解析用例），
  并修掉该测试自己的一处缺陷——旧正则不认单行元组，`_TOC_BULLETS` 整张漏检（8 张 39 对实为 9 张 41 对）。
  fixture 一律从 `src/test/servedGrammar.ts` 取表，不抄标签。255 passed（249 → 255）/ tsc clean / build ok。

- 2026-09-07 · 新建本目录 description.md（主人要求原则贯彻到文件树各层）。本目录代码未改。
