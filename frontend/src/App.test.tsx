import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

describe("App", () => {
  it("renders the workspace placeholder", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(<App />);

    expect(screen.getByRole("heading", { name: "AI 小说生成工作台" })).toBeTruthy();
    expect(screen.getByText(/项目骨架已就绪/)).toBeTruthy();
    expect(screen.getByText(/后端状态：检查中/)).toBeTruthy();
  });
});
