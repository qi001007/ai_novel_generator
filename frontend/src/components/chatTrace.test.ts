import { describe, expect, it } from "vitest";

import { reasoningParagraphs, stripProposalFences, traceActions } from "./chatTrace";

/* 第十七批批注 1: 「你一个字、一两个字一行就不对」. Rows written while the join bug was
   live stored one entry per streamed delta; they are still in the database, so the fold
   has to read them as the sentence they were meant to be. */
describe("reasoningParagraphs", () => {
  it("puts a shredded row back together", () => {
    const shredded = ["用户", "想", "让我", "用", "一句话", "说明", "第", "1", "章", "的", "收束", "问题。根据", "上下文", "弧", "1", "的", "收束"].join("\n\n");
    const out = reasoningParagraphs(shredded);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("用户想让我用一句话说明第1章的收束问题。根据上下文弧1的收束");
    expect(out[0]).not.toContain("\n");
  });

  it("leaves a clean row alone", () => {
    const clean = "用户问第1章的视角用谁。根据资料里的【D 简报 · 第 1 章】明确写着：视角：沈砚舟";
    expect(reasoningParagraphs(clean)).toEqual([clean]);
  });

  it("keeps real paragraphs from a multi-step turn", () => {
    const steps = ["先翻目录确认第 1 章的落点，再决定用谁的视角开场。", "资料里 D 简报已经写明视角，直接回答即可。"].join("\n\n");
    expect(reasoningParagraphs(steps)).toEqual([
      "先翻目录确认第 1 章的落点，再决定用谁的视角开场。",
      "资料里 D 简报已经写明视角，直接回答即可。",
    ]);
  });

  it("drops the line breaks inside a fragment without dropping its words", () => {
    expect(reasoningParagraphs("第一段\n仍然是一句\n完整的话\n\n第二段")).toEqual([
      "第一段仍然是一句完整的话",
      "第二段",
    ]);
  });

  it("answers nothing at all for an empty value", () => {
    expect(reasoningParagraphs("")).toEqual([]);
    expect(reasoningParagraphs("  \n\n  ")).toEqual([]);
  });
});

/* The blocks in here are the dialects the models actually wrote into this database -
   message 20 of novel 5 is the MiniMax one verbatim. A parser tested only on shapes I
   invented would pass while the real row fell back to raw text. */
describe("traceActions", () => {
  it("reads the Ruby-ish dialect MiniMax wrote into the stored row", () => {
    const block = `[TOOL_CALL]\n{tool => "read_file", args => {\n  --path "settings/foreshadow.md"\n}}\n[/TOOL_CALL]`;
    expect(traceActions([block])).toEqual([
      { name: "read_file", arg: "settings/foreshadow.md", raw: block },
    ]);
  });

  it("reads the JSON dialect", () => {
    const block = `[TOOL_CALL]\n{"name": "web_search", "arguments": {"query": "司天监 明代官署"}}\n[/TOOL_CALL]`;
    const [action] = traceActions([block]);
    expect(action.name).toBe("web_search");
    expect(action.arg).toBe("司天监 明代官署");
  });

  it("keeps the raw block when the name cannot be read, so the row cannot lie", () => {
    const block = "[TOOL_CALL]\n完全读不懂的一段\n[/TOOL_CALL]";
    const [action] = traceActions([block]);
    expect(action.name).toBeNull();
    expect(action.raw).toContain("完全读不懂的一段");
  });

  it("handles a call with no arguments", () => {
    const [action] = traceActions(['[TOOL_CALL]\n{"name": "list_files", "arguments": {}}\n[/TOOL_CALL]']);
    expect(action.name).toBe("list_files");
    expect(action.arg).toBeNull();
  });
});

/* 批次 35.21（2026-09-10 真机）：这条正文是作品 4 落库那条消息的形状——一句话，后面跟着
   整份被提议的 toc.md。卡片已经把同一份文件逐行列了一遍，正文再摊一遍就是「两个代码框」，
   而点完应用之后卡片走了、围栏留下，主人看到的就只剩一个代码框。 */
describe("stripProposalFences", () => {
  const offered = "目录排了三章，B 层落定。\n\n```markdown @toc.md\n# 目录（B 层 · 中期）\n\n## 第 1 章 未命名\n- **剧情功能**：开篇钩子\n```\n";

  it("keeps the sentence and drops the offered file", () => {
    expect(stripProposalFences(offered)).toBe("目录排了三章，B 层落定。");
  });

  it("keeps prose that follows a fence, so only the block goes", () => {
    expect(stripProposalFences("先给结论。\n\n```markdown @arcs.md\n# C 层\n```\n\n理由在后面。")).toBe(
      "先给结论。\n\n理由在后面。",
    );
  });

  it("leaves a quoted code block alone - it has no @path, so it is not an offer", () => {
    const quoted = "示例写法：\n\n```markdown\n## 剧情弧\n- 起始章: 1\n```\n";
    expect(stripProposalFences(quoted)).toBe(quoted.trim());
  });

  it("shows nothing of a fence that has not closed yet", () => {
    expect(stripProposalFences("目录排好了。\n\n```markdown @toc.md\n# 目录（B 层 · 中期）\n## 第 1 章")).toBe(
      "目录排好了。",
    );
  });

  it("accepts the yaml dialect the backend still accepts", () => {
    expect(stripProposalFences("好了。\n\n```yaml @settings/foreshadow.md\n伏笔: 3\n```\n")).toBe("好了。");
  });
});
