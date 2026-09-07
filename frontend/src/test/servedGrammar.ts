/**
 * 后端那张语法表的测试读法：直接解析 markdown_doc.py，产出投影会给出的 JSON。
 *
 * 为什么要有这个文件（候选 4c，2026-09-07）：前端那份本地表删掉以后，测试要喂给
 * 组件的 grammar 只能来自服务器会给出的那张表。在 fixture 里再手抄一遍标签，
 * 就是立起第三把表——而 4a 那次漂移（世界观/伏笔墙的标签前端零命中）正是抄出来的。
 * 解析规则与 `grammar_for_kind()` 一致：表名后缀决定 role，`_GRAMMAR` 决定 kind 用哪些表。
 */
import { readFileSync } from "node:fs";

import type { GrammarRow, ServedGrammar } from "../types";

// 本机 core.autocrlf=true：node 读到的 .py 可能是 CRLF，不归一正则就空跑成绿灯
const CODEC = readFileSync("../backend/app/services/markdown_doc.py", "utf8").replace(/\r\n/g, "\n");

const PAIR = /\(\s*"(\w+)"\s*,\s*"([^"]+)"\s*\)/g;

/**
 * 两种写法都要认：多行的 `= (` … `)` 与单行的 `= (("a","b"), ("c","d"))`。
 * 上一版对照测试只认前者，于是单行的 _TOC_BULLETS 整张表被跳过、
 * 后面的 _ARC_BULLETS 被算在它名下——39 对其实是 41 对，剧情功能/备注从没被核对过。
 */
export function backendTables(): Array<[string, GrammarRow[]]> {
  const out: Array<[string, GrammarRow[]]> = [];
  const head = /^_(\w+)_(SECTIONS|BULLETS) = \((.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = head.exec(CODEC))) {
    let body = m[3];
    if (!body.trimEnd().endsWith(")")) {
      for (const line of CODEC.slice(m.index + m[0].length).split("\n")) {
        if (line.startsWith(")")) break;
        body += "\n" + line;
      }
    }
    const rows: GrammarRow[] = [];
    for (const pair of body.matchAll(PAIR)) rows.push({ field: pair[1], label: pair[2] });
    out.push([`${m[1]}_${m[2]}`, rows]);
  }
  return out;
}

/** kind -> {role: rows}，逐字按后端 `_GRAMMAR` 的指向拼出来（表名沿用 Python 里那个大写名）。 */
export function servedGrammar(kind: string): ServedGrammar {
  const block = /^_GRAMMAR = \{([\s\S]*?)^\}/m.exec(CODEC);
  if (!block) throw new Error("markdown_doc.py 里找不到 _GRAMMAR，解析规则该跟着改了");
  const tables = new Map(backendTables());
  const served: ServedGrammar = {};
  for (const entry of (block[1] ?? "").matchAll(/"(\w+)":\s*\{([^}]*)\}/g)) {
    if (entry[1] !== kind) continue;
    for (const role of entry[2].matchAll(/"(\w+)":\s*_(\w+)/g)) {
      const rows = tables.get(role[2]);
      if (!rows) throw new Error(`_GRAMMAR 引用了一张不存在的表：_${role[2]}`);
      served[role[1] as "sections" | "bullets"] = rows.map((row) => ({ ...row }));
    }
  }
  return served;
}
