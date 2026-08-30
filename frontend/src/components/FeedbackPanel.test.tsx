import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FeedbackPanel from "./FeedbackPanel";

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

    render(<FeedbackPanel novelId={1} />);

    await waitFor(() => {
      expect(screen.getByText("主角不要这么早离开")).toBeTruthy();
    });
  });
});
