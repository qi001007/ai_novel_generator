/**
 * 流式行规则的单元测试：**没有 render、没有 fetch、与 StrictMode 无关**。
 * 这些语义原先只能靠「stub fetch + 手拼 SSE 字节 + 整树渲染」来验（候选 6 要解决的正是这个）。
 */
import { describe, expect, it } from "vitest";

import type { ChatContextPayload, ChatStreamEvent, StoredChatMessage } from "../types";
import { applyStreamEvent, type AgentRow, type Row } from "./chatRows";

const agent = (over: Partial<AgentRow> = {}): AgentRow => ({
  kind: "agent",
  id: 1,
  text: "",
  status: "streaming",
  question: "q",
  meta: {},
  ...over,
});
const rows = (...items: Row[]): Row[] => [...items];
const ctx = (over: Partial<ChatContextPayload> = {}): ChatStreamEvent =>
  ({ event: "context", data: { items: [], unknown_mentions: [], ...over } }) as ChatStreamEvent;
const msg = (over: Partial<StoredChatMessage> = {}): ChatStreamEvent =>
  ({
    event: "done",
    data: { message: { content: "", model: "m", token_input: 1, token_output: 2, context_refs: [], reasoning: "", ...over } },
  }) as ChatStreamEvent;
const only = (list: Row[]): AgentRow => list[0] as AgentRow;

describe("chatRows.applyStreamEvent", () => {
  it("把 delta 累加到指定那一行，别的行不动", () => {
    const out = applyStreamEvent(
      rows(agent({ id: 1 }), agent({ id: 2, text: "keep" })),
      1,
      { event: "delta", data: { text: "第一段" } } as ChatStreamEvent,
    );
    expect(only(out).text).toBe("第一段");
    expect((out[1] as AgentRow).text).toBe("keep");
  });

  it("思考过程先到时正文还是空的（第二十九批批注 6 的核心语义）", () => {
    const out = applyStreamEvent(rows(agent()), 1, {
      event: "reasoning", data: { text: "先看碑文" },
    } as ChatStreamEvent);
    expect(only(out).meta.reasoning).toBe("先看碑文");
    expect(only(out).text).toBe("");
  });

  it("连续两条 reasoning 是累加而不是覆盖", () => {
    let list = rows(agent());
    for (const piece of ["甲", "乙"]) {
      list = applyStreamEvent(list, 1, { event: "reasoning", data: { text: piece } } as ChatStreamEvent);
    }
    expect(only(list).meta.reasoning).toBe("甲乙");
  });

  it("工具轨迹按到达顺序累加，失败的那次写明未成功", () => {
    let list = rows(agent());
    list = applyStreamEvent(list, 1, {
      event: "tool",
      data: { step: 1, name: "read_file", arguments: { path: "a.md" }, ok: true, ms: 1400, chars: 1234 },
    } as ChatStreamEvent);
    list = applyStreamEvent(list, 1, {
      event: "tool",
      data: { step: 2, name: "web_search", arguments: {}, ok: false, ms: 900, chars: 0 },
    } as ChatStreamEvent);
    expect(only(list).meta.reads).toEqual([
      "第 1 步 · read_file a.md · 1.4s · 1.2k 字",
      "第 2 步 · web_search · 900ms · 0 字 未成功",
    ]);
  });

  it("done 不许抹掉早到的工具轨迹、refs 与 allowed", () => {
    let list = rows(agent());
    list = applyStreamEvent(list, 1, ctx({
      items: [{ kind: "blueprint", label: "A 全书蓝图", ref: "blueprint", score: 1 }],
      unknown_mentions: ["@鬼"],
      tools: ["read_file"],
    }));
    list = applyStreamEvent(list, 1, {
      event: "tool",
      data: { step: 1, name: "read_file", arguments: { p: "x" }, ok: true, ms: 12, chars: 8 },
    } as ChatStreamEvent);
    list = applyStreamEvent(list, 1, msg({ content: "正文", reasoning: "整段的思考" }));
    const meta = only(list).meta;
    expect(meta.reads).toEqual(["第 1 步 · read_file x · 12ms · 8 字"]);
    expect(meta.allowed).toEqual(["read_file"]);
    expect(meta.unknown).toEqual(["@鬼"]);
    expect(meta.refs?.map((r) => r.ref)).toEqual(["blueprint"]);  // 先到的赢，不被 done 覆盖
    expect(meta.reasoning).toBe("整段的思考");
    expect(only(list).status).toBe("done");
  });

  it("done 里 reasoning 为空时保留流式攒下的那一份", () => {
    let list = applyStreamEvent(rows(agent()), 1, {
      event: "reasoning", data: { text: "路上攒的" },
    } as ChatStreamEvent);
    list = applyStreamEvent(list, 1, msg({ reasoning: "" }));
    expect(only(list).meta.reasoning).toBe("路上攒的");
  });

  it("error 用 partial；没有 partial 就清空正文（与搬家前的实现逐字等价）", () => {
    const withPartial = applyStreamEvent(rows(agent()), 1, {
      event: "error", data: { message: "", partial: "写到一半" },
    } as ChatStreamEvent);
    expect(only(withPartial).text).toBe("写到一半");
    expect(only(withPartial).error).toBe("模型没有返回内容");
    const without = applyStreamEvent(rows(agent({ text: "半截" })), 1, {
      event: "error", data: { message: "断了", partial: "" },
    } as ChatStreamEvent);
    expect(only(without).text).toBe("");
    expect(only(without).error).toBe("断了");
  });

  it("end 只收尾还在流的那条，已经报错的行不许被翻案", () => {
    const out = applyStreamEvent(
      rows(agent({ id: 1 }), agent({ id: 2, status: "error", error: "断了" })),
      2,
      { event: "end", data: null } as ChatStreamEvent,
    );
    expect((out[1] as AgentRow).status).toBe("error");  // 看的是被点名的第 2 行
    const ok = applyStreamEvent(rows(agent()), 1, { event: "end", data: null } as ChatStreamEvent);
    expect(only(ok).status).toBe("done");
  });

  it("proposal 不改行；id 对不上时原样返回", () => {
    const before = rows(agent({ text: "x" }));
    expect(applyStreamEvent(before, 1, {
      event: "proposal", data: { path: "A.md", text: "t", valid: true, error: "" },
    } as ChatStreamEvent)).toEqual(before);
    expect(applyStreamEvent(before, 99, { event: "delta", data: { text: "y" } } as ChatStreamEvent)).toEqual(before);
  });
});
