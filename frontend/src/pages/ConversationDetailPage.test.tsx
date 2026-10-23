/* 批注：消息列表挤在一起、行内展开同样挤。四条用例钉住新规矩：
   长消息只露带段落的摘要，全文另开浮窗，用户与 AI 有不同角色外观，搜索照旧过滤。 */
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConversationDetailPage from "./ConversationDetailPage";
import type { ChatConversation, StoredChatMessage } from "../types";

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const longTail = "他把灯芯压低，整座塔只剩下一线光。";
const longAnswer = `## 第一节\n\n${"林漱沿着石阶往上走，海风从窗缝里灌进来。".repeat(20)}\n\n${longTail}`;
const longQuestionTail = "塔门只开一次。";
const longQuestion = `补充设定：\n\n${"灯塔立在北海孤岛上，守夜人每天擦一次透镜。".repeat(20)}\n\n${longQuestionTail}`;

const base = {
  novel_id: 1,
  reasoning: "",
  mode: "agent",
  model: "qwen3.8-flash",
  mentions: [],
  context_refs: [],
  token_output: 10,
  created_at: "2026-10-22T10:00:00+08:00",
};

const messages: StoredChatMessage[] = [
  { ...base, id: 1, role: "user", content: "讲一个守塔人的故事。", model: "user", token_input: 0, created_at: "2026-10-22T09:58:00+08:00" },
  { ...base, id: 2, role: "assistant", content: "好的，主角叫林漱。", token_input: 12 },
  { ...base, id: 3, role: "assistant", content: longAnswer, token_input: 40 },
  { ...base, id: 4, role: "user", content: longQuestion, model: "user", token_input: 0, created_at: "2026-10-22T10:01:00+08:00" },
];

const conversations: ChatConversation[] = [
  { conversation_id: 7, first_question: "讲一个守塔人的故事。", message_count: 4, updated_at: "2026-10-22T10:01:00+08:00", is_current: true },
];

function stubServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/chat/messages")) return json(messages);
      if (url.includes("/chat/conversations")) return json(conversations);
      return json([]);
    }),
  );
}

async function openDetail() {
  render(
    <MemoryRouter initialEntries={["/novels/1/conversations/7"]}>
      <Routes>
        <Route path="/novels/:novelId/conversations/:conversationId" element={<ConversationDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelectorAll(".conversation-detail-message").length).toBe(4));
}

function buttonIn(row: Element, label: string): HTMLButtonElement {
  return [...row.querySelectorAll("button")].find((button) => button.textContent === label) as HTMLButtonElement;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  stubServer();
});

describe("ConversationDetailPage 消息排版与全文浮窗", () => {
  it("长回答行内只留带段落的摘要，查看全文在浮窗里打开", async () => {
    await openDetail();
    const rows = [...document.querySelectorAll(".conversation-detail-message")];
    const longRow = rows[2];

    expect(longRow.textContent).toContain("查看全文");
    expect(longRow.textContent).not.toContain(longTail);
    expect(longRow.querySelector(".chat-md")).toBeNull();
    expect(longRow.querySelector(".conversation-preview")?.textContent).toContain("\n\n");

    fireEvent.click(buttonIn(longRow, "查看全文"));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("AI · 全文");
    expect(dialog.textContent).toContain(longTail);
    expect(rows[2].textContent).not.toContain(longTail);

    fireEvent.click(dialog.querySelector('button[aria-label="关闭"]')!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(document.querySelectorAll(".conversation-detail-message").length).toBe(4);
  });

  it("用户长消息同样只露摘要，全文在主人浮窗里打开", async () => {
    await openDetail();
    const userRow = [...document.querySelectorAll(".conversation-detail-message")][3];

    expect(userRow.className).toContain("is-user");
    expect(userRow.textContent).toContain("查看全文");
    expect(userRow.textContent).not.toContain(longQuestionTail);

    fireEvent.click(buttonIn(userRow, "查看全文"));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("主人 · 全文");
    expect(dialog.textContent).toContain(longQuestionTail);
  });

  it("用户与 AI 使用不同的角色标识与底色类", async () => {
    await openDetail();
    const rows = [...document.querySelectorAll(".conversation-detail-message")];

    expect(rows[0].className).toContain("is-user");
    expect(rows[1].className).toContain("is-assistant");
    expect(rows[2].className).toContain("is-assistant");
    expect(rows[3].className).toContain("is-user");
    expect(rows[0].querySelector(".conversation-role")?.textContent).toBe("主人");
    expect(rows[1].querySelector(".conversation-role")?.textContent).toBe("AI");
    expect(rows[1].textContent).toContain("qwen3.8-flash");
    expect(rows[0].textContent).not.toContain("qwen3.8-flash");
  });

  it("搜索按问题与回答过滤，并显示命中数", async () => {
    await openDetail();
    const search = document.querySelector('input[aria-label="搜索对话"]')!;

    fireEvent.change(search, { target: { value: "守塔人" } });
    await waitFor(() => expect(document.querySelectorAll(".conversation-detail-message").length).toBe(1));
    expect(document.querySelector(".conversation-search-bar > span")?.textContent).toBe("1 / 4");
    expect(document.querySelector(".conversation-detail-message")?.textContent).toContain("讲一个守塔人的故事");

    fireEvent.change(search, { target: { value: "海风" } });
    await waitFor(() => expect(document.querySelectorAll(".conversation-detail-message").length).toBe(1));
    expect(document.querySelector(".conversation-detail-message")?.textContent).toContain("查看全文");

    fireEvent.change(search, { target: { value: "塔门只开一次" } });
    await waitFor(() => expect(document.querySelectorAll(".conversation-detail-message").length).toBe(1));
    expect(document.querySelector(".conversation-detail-message")?.className).toContain("is-user");

    fireEvent.change(search, { target: { value: "不存在的词" } });
    await waitFor(() => expect(document.querySelectorAll(".conversation-detail-message").length).toBe(0));
    expect(document.body.textContent).toContain("没有匹配的消息");
  });
});
