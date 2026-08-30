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
const generationRun = {
  id: 3,
  chapter_id: 2,
  task_type: "draft",
  model: "test-model",
  status: "completed",
  token_input: 120,
  token_output: 80,
};
const review = {
  id: 4,
  chapter_id: 2,
  reviewer: "ai",
  decision: "passed",
  comments: "整体合格。",
  scores: { consistency: 8 },
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
      if (url.includes("/generation-runs")) return response([generationRun]);
      if (url.includes("/reviews")) return response([review]);
      if (url.includes("/chapters")) return response([chapter]);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "第 1 章" })).toBeTruthy();
    });
    const textarea = screen.getByLabelText("章节正文") as HTMLTextAreaElement;
    expect(textarea.value).toBe("旧正文。");

    await waitFor(() => {
      expect(screen.getByText("test-model")).toBeTruthy();
      expect(screen.getByText("整体合格。")).toBeTruthy();
    });
  });
});
