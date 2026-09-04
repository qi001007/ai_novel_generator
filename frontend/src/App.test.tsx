import { StrictMode } from "react";
import { fireEvent } from "@testing-library/react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import { useFiles } from "./store/files";

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

    render(
      <MemoryRouter initialEntries={["/novels/1"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // The chapter name now lives in exactly one place: the tab. The toolbar used
      // to repeat it as an <h2>, which is what the owner called "同一信息出现两次".
      expect(screen.getByRole("tab", { name: /第 1 章 未命名/ })).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "第 1 章 未命名" })).toBeNull();
    // 批注 1: status is still a dot with its own accessible name, but it lives in one
    // place only - the tree row, where chapters can be compared. The tab used to pin
    // a permanent "draft" ring next to an unsaved dot that only appears once you type:
    // two marks, one already obvious. And the close button now names the chapter it
    // closes - it used to read the JSX expression out loud instead of its value.
    expect(screen.getAllByLabelText("第 1 章 状态：草稿")).toHaveLength(1);
    expect(
      screen.queryByRole("tab", { name: /第 1 章 未命名/ })?.querySelector(".status-dot"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "关闭第 1 章" })).toBeTruthy();
    const textarea = screen.getByLabelText("章节正文") as HTMLTextAreaElement;
    expect(textarea.value).toBe("旧正文。");

    // The records panel is folded on entry (批注 17), so reaching a record is
    // now a two-step contract: open it, then the row and its detail link exist.
    fireEvent.click(screen.getByRole("button", { name: "展开调用记录" }));
    await waitFor(() => {
      expect(screen.getByText("test-model")).toBeTruthy();
      expect(screen.getByRole("button", { name: "详情" })).toBeTruthy();
      // One entry point per record: the header shortcut disagreed with this.
      expect(screen.queryByRole("button", { name: "查看调用详情" })).toBeNull();
    });
  });

  it("comes back to the prose after a run detail page", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      const response = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      if (url.endsWith("/api/health")) return response({ status: "ok" });
      if (url.endsWith("/api/novels")) return response([novel]);
      if (url.endsWith("/files")) return response([]);
      if (url.includes("/machine-check")) {
        return response({ passed: true, word_count: 4, issues: [] });
      }
      if (url.includes("/planning/briefs")) return response([]);
      if (url.includes("/generation-runs")) return response([generationRun]);
      if (url.includes("/reviews")) return response([review]);
      if (url.includes("/chapters")) return response([chapter]);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    // Opening a file leaves this counter behind, because the store outlives the
    // route. Owner 2026-09-03: leaving a run detail page put the author back on
    // that file rather than on the chapter they had come from.
    useFiles.setState({ revealSeq: 3 });

    // StrictMode because main.tsx uses it: its double effect run is what made
    // the first version of this fix pass here and fail in the browser.
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/novels/1?chapter=2"]}>
          <App />
        </MemoryRouter>,
      </StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("章节正文")).toBeTruthy();
    });
    expect(document.querySelector(".file-editor")).toBeNull();
  });
});
