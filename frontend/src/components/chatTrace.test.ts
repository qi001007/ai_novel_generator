import { describe, expect, it } from "vitest";

import { reasoningParagraphs } from "./chatTrace";

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
