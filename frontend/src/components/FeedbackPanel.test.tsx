import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import FeedbackPanel from "./FeedbackPanel";
import { ToastProvider } from "./ui";

describe("FeedbackPanel", () => {
  it("lists feedback", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/feedback")) {
        return Promise.resolve(new Response(JSON.stringify([
          { id: 1, content: "主角不要这么早离开", impact_levels: ["D"], status: "pending" },
        ]), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<ToastProvider><FeedbackPanel novelId={1} /></ToastProvider>);

    await waitFor(() => {
      expect(screen.getByText("主角不要这么早离开")).toBeTruthy();
    });
  });

  it("creates, searches, edits and deletes plain whole-book notes", async () => {
    const user = userEvent.setup();
    let records = [
      { id: 1, content: "检查前卷时间线", created_at: "2026-10-18T08:00:00Z", updated_at: "2026-10-18T08:00:00Z" },
      { id: 2, content: "保留结局伏笔", created_at: "2026-10-19T08:00:00Z", updated_at: "2026-10-19T08:00:00Z" },
    ];
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      if (!url.includes("/feedback")) return Promise.reject(new Error(`unexpected url: ${url}`));
      if (method === "POST") records = [...records, { id: 3, content: JSON.parse(String(init?.body)).content, created_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z" }];
      if (method === "PUT") records = records.map((item) => item.id === 3 ? { ...item, content: JSON.parse(String(init?.body)).content } : item);
      if (method === "DELETE") records = records.filter((item) => item.id !== Number(url.split("/").at(-1)));
      return Promise.resolve(new Response(method === "GET" ? JSON.stringify(records) : "null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }));

    render(<ToastProvider><FeedbackPanel novelId={1} /></ToastProvider>);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("保留结局伏笔");

    await user.click(screen.getByRole("button", { name: /新增/ }));
    await user.type(screen.getByRole("textbox", { name: "反馈内容" }), "统一称谓");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("统一称谓")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "搜索反馈" }), "统一");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "编辑反馈 3" }));
    await user.clear(screen.getByRole("textbox", { name: "反馈内容" }));
    await user.type(screen.getByRole("textbox", { name: "反馈内容" }), "统一人物称谓");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("统一人物称谓")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "删除反馈 3" }));
    await waitFor(() => expect(screen.queryByText("统一人物称谓")).toBeNull());
  });
});
