import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SettingsPanel from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("lists setting cards", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/settings")) {
        return Promise.resolve(new Response(JSON.stringify([
          {
            id: 1,
            category: "worldview",
            name: "力量体系",
            content: "以灵纹为核心。",
            is_confirmed: true,
          },
        ]), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<SettingsPanel novelId={1} />);

    await waitFor(() => {
      expect(screen.getByText("力量体系")).toBeTruthy();
    });
    expect(screen.getAllByText("以灵纹为核心。").length).toBeGreaterThan(0);
  });
});
