/**
 * 投影语法的对照测试：后端会打出来的每一枚中文标签，前端必须认得。
 *
 * 为什么要有这个文件（候选 4，2026-09-07）：语法表有两把——后端
 * `backend/app/services/markdown_doc.py`（真正的编解码器）与前端
 * `src/components/cmDoc.ts`（导轨锁定、字段跳转、面包屑靠它认行）。
 * 实测漂移已发生：后端渲染的「类别/已确认/来源章/现况/内容/姓名/分级/埋设章/预计收章/已收章」
 * 在 cmDoc.ts 里**零命中**，于是世界观、伏笔墙、人物档案这些文档在编辑器里
 * 不被认成结构行——没有导轨、focusField 跳不过去、面包屑只能回显英文字段名。
 * 这条测试把"加一个字段只改一处"的漏口堵上：以后后端多一枚标签而前端没跟上，就直接红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BULLET_FIELDS, FIELD_LABEL, HEADING_FIELDS } from "./components/cmDoc";

// 本机 core.autocrlf=true：工作树里的 .py 是 CRLF，node 不会替我归一
const CODEC = readFileSync("../backend/app/services/markdown_doc.py", "utf8").replace(/\r\n/g, "\n");
const PAIR = /\("(\w+)", "([^"]+)"\)/g;

/** 表名决定命名空间：*_SECTIONS 是 `##` 标题行，*_BULLETS 是 `- **标签**：` 项行。 */
function tables(): Array<[string, Array<[string, string]>]> {
  const out: Array<[string, Array<[string, string]>]> = [];
  const re = /^_(\w+?)_(SECTIONS|BULLETS) = \(\n([\s\S]*?)^\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CODEC))) {
    const pairs: Array<[string, string]> = [];
    for (const pair of m[3].matchAll(PAIR)) pairs.push([pair[1], pair[2]]);
    out.push([`${m[1]}_${m[2]}`, pairs]);
  }
  return out;
}

const ALL = tables();
const labelToFields = (kind: "SECTIONS" | "BULLETS") => {
  const map = new Map<string, string[]>();
  for (const [name, pairs] of ALL) {
    if (!name.endsWith(kind)) continue;
    for (const [field, label] of pairs) {
      map.set(label, [...(map.get(label) ?? []), field]);
    }
  }
  return map;
};

/**
 * 一处标签在同一个命名空间里对应多个字段时，扁平的「标签→字段」表表达不了。
 * 这三处是**已知欠账**（候选 4 的下一片要把它变成按 kind 查表，或由后端随投影把表发下来）：
 * 人物档案的「目标」会被认成简报的 goal，人物的「起始章/结束章」会被认成弧的字段。
 * 列在这里而不是默默忽略：谁再撞一处，这条测试就红。
 */
const KNOWN_AMBIGUOUS: Record<string, string> = {
  "SECTIONS:目标": "goal|goals",
  "BULLETS:起始章": "start_chapter|expected_start_chapter",
  "BULLETS:结束章": "end_chapter|expected_end_chapter",
};

describe("投影语法对照", () => {
  it("后端语法表不止一张（防止解析空跑成绿灯）", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(6);
    // 2026-09-07 实测 39 对；这条只是防空跑，不是规格
    expect(ALL.reduce((n, [, pairs]) => n + pairs.length, 0)).toBeGreaterThanOrEqual(39);
  });

  it("后端会打的每一枚标签，前端 FIELD_LABEL 都认得（field -> label）", () => {
    for (const [name, pairs] of ALL) {
      for (const [field, label] of pairs) {
        expect(`${name}:${field} => ${label}`).toBe(`${name}:${field} => ${FIELD_LABEL[field] ?? "（前端不认识这个字段）"}`);
      }
    }
  });

  it("能被唯一反查的标签，前端反查表必须指回同一个字段（label -> field）", () => {
    for (const kind of ["SECTIONS", "BULLETS"] as const) {
      const table = kind === "SECTIONS" ? HEADING_FIELDS : BULLET_FIELDS;
      for (const [label, fields] of labelToFields(kind)) {
        const unique = [...new Set(fields)];
        if (unique.length > 1) {
          expect(KNOWN_AMBIGUOUS[`${kind}:${label}`]).toBe(unique.join("|"));
          continue;
        }
        expect(`${kind}:${label} => ${table[label] ?? "（前端不认识这个标签）"}`).toBe(`${kind}:${label} => ${unique[0]}`);
      }
    }
  });

  it("已知欠账没有悄悄变多", () => {
    const found: string[] = [];
    for (const kind of ["SECTIONS", "BULLETS"] as const) {
      for (const [label, fields] of labelToFields(kind)) {
        if (new Set(fields).size > 1) found.push(`${kind}:${label}`);
      }
    }
    expect(found.sort()).toEqual(Object.keys(KNOWN_AMBIGUOUS).sort());
  });
});
