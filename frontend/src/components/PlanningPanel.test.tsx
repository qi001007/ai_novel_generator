import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PlanningPanel from "./PlanningPanel";

describe("PlanningPanel", () => {
  it("loads planning layers", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      const response = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      if (url.includes("/planning/blueprints")) return response([]);
      if (url.includes("/planning/toc")) return response([]);
      if (url.includes("/planning/arcs")) return response([]);
      if (url.includes("/planning/briefs")) return response([]);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<PlanningPanel novelId={1} />);

    await waitFor(() => {
      expect(screen.getByText("A 全书蓝图")).toBeTruthy();
    });
    expect(screen.getByText("B 目录规划")).toBeTruthy();
  });
});
