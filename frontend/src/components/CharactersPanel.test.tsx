import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CharactersPanel from "./CharactersPanel";

describe("CharactersPanel", () => {
  it("lists character cards", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/characters")) {
        return Promise.resolve(new Response(JSON.stringify([
          {
            id: 1,
            name: "主角",
            level: "protagonist",
            identity: "青年修士",
            goals: "寻找父亲下落",
          },
        ]), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<CharactersPanel novelId={1} />);

    await waitFor(() => {
      expect(screen.getByText("主角")).toBeTruthy();
    });
    expect(screen.getByText("青年修士")).toBeTruthy();
    expect(screen.getByText("寻找父亲下落")).toBeTruthy();
  });
});
