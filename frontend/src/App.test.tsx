import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

const novel = { id: 1, title: "测试作品" };
const chapter = {
  id: 2,
  brief_id: null,
  chapter_number: 1,
  content: "旧正文。",
  status: "draft",
};

describe("App", () => {
  it("opens the chapter editor", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      const response = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

      if (url.endsWith("/api/health")) return response({ status: "ok" });
      if (url.endsWith("/api/novels")) return response([novel]);
      if (url.includes("/planning/briefs")) return response([]);
      if (url.includes("/chapters")) return response([chapter]);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "第 1 章" })).toBeTruthy();
    });
    const textarea = screen.getByLabelText("章节正文") as HTMLTextAreaElement;
    expect(textarea.value).toBe("旧正文。");
  });
});
