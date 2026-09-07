/**
 * 投影语法只剩一把表：这张测试钉的是「后端那张表必须原样到前端」，不是两把表互相对照。
 *
 * 沿革（候选 4，2026-09-07 三片）：
 * - 4a 后端与前端各有一份表，测试把两份逐对对照，并把三处「一枚标签指两个字段」
 *   列成 KNOWN_AMBIGUOUS 清单；
 * - 4b 后端把表随投影发出（`markdown_doc.grammar_for_kind`）；
 * - 4c（本文件现在钉的）前端那份本地表删除，改按 kind 消费服务器给的表。
 *   于是对照测试从「两份都得认」升级成两条更强的：**前端不许再有第二把表**，
 *   以及**按 kind 解析键行**——那三处撞车（目标／起始章／结束章）不再靠
 *   「一个文档不会同时装两种」侥幸，而是由 kind 各自解开。
 * KNOWN_AMBIGUOUS 随之下线，替它的是「同一 kind 同一 role 里标签唯一」那条：
 * 断言 4 条 -> 10 条，一条没减（D-33）。
 *
 * 期望数字为什么会变：上一版解析 `_XXX_SECTIONS/BULLETS` 的正则要求 `= (` 之后紧跟
 * 换行，单行写法的 `_TOC_BULLETS` 整张被跳过、后面的 `_ARC_BULLETS` 被算进它名下，
 * 于是「8 张表 39 对」其实是 9 张 41 对——剧情功能/备注（正是 B→D 跳转那两个字段）
 * 从来没被核对过。现在两种写法都认，防空跑那条按 9/41 钉。
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import cmDocSource from "./components/cmDoc.ts?raw";
import { editorExtensions, focusField, grammarOf, scanDoc, setDocConfig } from "./components/cmDoc";
import type { ServedGrammar } from "./types";
import { backendTables, servedGrammar } from "./test/servedGrammar";

const KINDS = ["blueprint", "toc", "arcs", "brief", "foreshadow", "worldview", "character"];
const ALL_TABLES = backendTables();
const rowsOf = (kind: string, role: "sections" | "bullets") => servedGrammar(kind)[role] ?? [];
/**
 * 一把 field<->label 表的三种字面量形状。锚点用的 `## 伏笔 N` 那几枚正则不算——
 * 它们是记录主键而不是标签表，那部分欠账登记在候选 4d（与 CharacterFormCard/TocListView 同批）。
 */
const TABLE_SHAPES: Array<[string, RegExp]> = [
  ["field->label 表", /^\s*[a-z_][a-z0-9_]*[ \t]*:[ \t]*"[^"]*[\u4e00-\u9fff][^"]*"/gm],
  ["label->field 表（未加引号）", /^\s*[\u4e00-\u9fff][\w\u4e00-\u9fff]*[ \t]*:[ \t]*"[a-z_][a-z0-9_]*"/gm],
  ["label->field 表（加引号）", /^\s*"[^"]*[\u4e00-\u9fff][^"]*"[ \t]*:[ \t]*"[a-z_][a-z0-9_]*"/gm],
];

/** 去掉注释只留代码：表藏在注释里不算违规，藏在字面量里才算。 */
const cmDocCode = cmDocSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 按服务器给的表生成一份该 kind 的文档，并记下每一枚键行落在第几行、该解析成哪个字段。 */
function build(kind: string) {
  const served = servedGrammar(kind);
  const lines: string[] = [`# ${kind}（语法测试文档）`, ""];
  const keyLines = new Map<number, string>();
  for (const row of served.bullets ?? []) {
    lines.push(`- **${row.label}**：值`);
    keyLines.set(lines.length, row.field);
  }
  for (const row of served.sections ?? []) {
    lines.push("", `## ${row.label}`);
    keyLines.set(lines.length, row.field);
    lines.push("", "正文一段");
  }
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc: lines.join("\n"), extensions: editorExtensions }),
  });
  view.dispatch({
    effects: setDocConfig({
      grammar: grammarOf(served),
      lockedFields: [],
      pendingLines: [],
      jumpFrom: false,
    }),
  });
  const scanned = scanDoc(view)
    .filter((entry) => entry.field)
    .map((entry) => ({ line: entry.line, field: entry.field }));
  return {
    view,
    served,
    /** scanDoc 真正认出来的键行。 */
    keys: () => scanned.map((entry) => `${entry.line}:${entry.field}`),
    /** 生成文档时就已知的真值：第几行是哪枚键行、该解析成哪个字段。 */
    expected: () =>
      [...keyLines]
        .sort((a, b) => a[0] - b[0])
        .map(([line, field]) => `${line}:${field}`),
    fields: () => scanned.map((entry) => entry.field),
    caretOf: (field: string) => {
      focusField(view, field);
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    },
  };
}

describe("投影语法一把表", () => {
  it("后端语法表不止一张（防止解析空跑成绿灯）", () => {
    expect(ALL_TABLES.length).toBeGreaterThanOrEqual(9);
    // 2026-09-07 实测 9 张 41 对；上一版因为漏了单行写法只数到 8/39（见文件头）
    expect(ALL_TABLES.reduce((n, [, rows]) => n + rows.length, 0)).toBeGreaterThanOrEqual(41);
    expect(rowsOf("toc", "bullets").map((row) => row.field)).toEqual(["plot_function", "notes"]);
  });

  it("前端 cmDoc.ts 里不再有第二把表（三张本地表已删，换个名字重长也不行）", () => {
    for (const name of ["FIELD_LABEL", "HEADING_FIELDS", "BULLET_FIELDS"]) {
      expect(cmDocCode).not.toContain(name);
    }
    // 表的形状有三种写法都算：`字段: "中文标签"`、`中文标签: "字段"`（旧 HEADING_FIELDS 就是这种，
    // 中文是合法标识符所以不带引号）、`"中文标签": "字段"`。去注释后本文件这三种各为 0 命中。
    for (const [shape, pattern] of TABLE_SHAPES) {
      expect([...cmDocCode.matchAll(pattern)].map((m) => m[0].trim()), `cmDoc.ts 里长出了${shape}`).toEqual([]);
    }
  });

  it("后端每一对（字段, 标签）都随某个 kind 发得出去，前端因此不必自带", () => {
    const served = new Set(
      KINDS.flatMap((kind) => {
        const table: ServedGrammar = servedGrammar(kind);
        return [...(table.bullets ?? []), ...(table.sections ?? [])].map(
          (row) => `${row.field}=${row.label}`,
        );
      }),
    );
    for (const [name, rows] of ALL_TABLES) {
      for (const row of rows) {
        expect(served.has(`${row.field}=${row.label}`), `${name} 的 ${row.field}=${row.label} 没有 kind 会发出`).toBe(true);
      }
    }
  });

  it("按 kind 查表后不再有歧义：同一 kind 同一 role 里一枚标签只指一个字段", () => {
    for (const kind of KINDS) {
      const table = servedGrammar(kind);
      for (const role of ["sections", "bullets"] as const) {
        const seen = new Map<string, string>();
        for (const row of table[role] ?? []) {
          expect(seen.has(row.label), `${kind}.${role} 里 ${row.label} 撞了两个字段`).toBe(false);
          seen.set(row.label, row.field);
        }
      }
      // 面包屑是 field -> label，反过来也得唯一
      const byField = new Map<string, string>();
      for (const row of [...(table.bullets ?? []), ...(table.sections ?? [])]) {
        expect(byField.has(row.field), `${kind} 的 ${row.field} 有两个标签，面包屑会摇摆`).toBe(false);
        byField.set(row.field, row.label);
      }
    }
  });

  it("每个 kind 的每一枚键行都能解析回它自己的字段", () => {
    for (const kind of KINDS) {
      const probe = build(kind);
      // 先确认这张文档真装了键行，否则下面那条整表比对是空跑
      expect(probe.expected().length).toBeGreaterThanOrEqual(2);
      // 全等：既不许漏解析一枚，也不许多认一行
      expect(probe.keys()).toEqual(probe.expected());
      probe.view.destroy();
    }
  });

  it("世界观的键行按 kind 解析", () => {
    const probe = build("worldview");
    expect(probe.fields()).toEqual(["category", "is_confirmed", "source_chapter", "current_state", "content"]);
    probe.view.destroy();
  });

  it("伏笔墙的键行按 kind 解析", () => {
    const probe = build("foreshadow");
    expect(probe.fields()).toEqual([
      "planted_chapter",
      "expected_payoff_chapter",
      "payoff_chapter",
      "status",
      "content",
    ]);
    probe.view.destroy();
  });

  it("人物档案的键行按 kind 解析（起始章/结束章是 expected_*，目标是档案自己的 goals）", () => {
    const probe = build("character");
    expect(probe.fields()).toEqual([
      "name",
      "level",
      "expected_start_chapter",
      "expected_end_chapter",
      "identity",
      "goals",
      "behavior_constraints",
      "current_status",
    ]);
    probe.view.destroy();
  });

  it("三处标签撞车按 kind 各自解开，且异域字段认不出来", () => {
    const label = (kind: string, role: "sections" | "bullets", field: string) =>
      rowsOf(kind, role).find((row) => row.field === field)?.label;
    // 同一个人看到的还是同一个词，不同的是它背后那个字段
    expect(label("brief", "sections", "goal")).toBe(label("character", "sections", "goals"));
    expect(label("arcs", "bullets", "start_chapter")).toBe(label("character", "bullets", "expected_start_chapter"));
    expect(label("arcs", "bullets", "end_chapter")).toBe(label("character", "bullets", "expected_end_chapter"));
    const brief = build("brief");
    const sheet = build("character");
    const arcs = build("arcs");
    expect(brief.fields()).toContain("goal");
    expect(brief.fields()).not.toContain("goals");
    expect(sheet.fields()).toContain("goals");
    expect(sheet.fields()).not.toContain("goal");
    expect(arcs.fields()).toContain("start_chapter");
    expect(arcs.fields()).not.toContain("expected_start_chapter");
    expect(sheet.fields()).toContain("expected_start_chapter");
    expect(sheet.fields()).not.toContain("start_chapter");
    // 弧的「目标」是第三个字段，谁都不许冒充它
    expect(arcs.fields()).toContain("objective");
    for (const probe of [brief, sheet, arcs]) probe.view.destroy();
  });

  it("focusField 只跳本文档 kind 认得的字段，段落型落点小节正文", () => {
    const sheet = build("character");
    expect(sheet.caretOf("goals")).toBe(14);
    expect(focusField(sheet.view, "goal")).toBe(false);
    expect(focusField(sheet.view, "expected_start_chapter")).toBe(true);
    expect(focusField(sheet.view, "start_chapter")).toBe(false);
    const brief = build("brief");
    expect(focusField(brief.view, "goal")).toBe(true);
    expect(focusField(brief.view, "goals")).toBe(false);
    const arcs = build("arcs");
    expect(focusField(arcs.view, "start_chapter")).toBe(true);
    expect(focusField(arcs.view, "expected_start_chapter")).toBe(false);
    for (const probe of [sheet, brief, arcs]) probe.view.destroy();
  });
});
