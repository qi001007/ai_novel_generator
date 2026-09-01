import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";

function stubFetch() {
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/health")) return json({ status: "ok" });
      if (url.endsWith("/api/novels")) {
        return json([
          {
            id: 1,
            title: "拖拽测试",
            description: "",
            target_chapters: 0,
            style_constraints: "",
            cover_image: "",
          },
        ]);
      }
      if (url.includes("/llm/status")) {
        return json({
          provider: "fake",
          configured: true,
          models: { chat: true },
          available_models: ["fake-chat"],
        });
      }
      return json([]);
    }),
  );
}

function workspace() {
  return document.querySelector(".workspace") as HTMLElement;
}

function sidebar() {
  return document.querySelector(".sidebar") as HTMLElement;
}

function columns() {
  return workspace().style.gridTemplateColumns;
}

describe("workbench layout", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("resizes the sidebar with the separator and persists it", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(
      <MemoryRouter initialEntries={["/novels/1"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(columns()).toContain("280px");
    });

    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(2);

    separators[0].focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");

    await waitFor(() => {
      expect(columns()).toContain("312px");
    });
    expect(JSON.parse(localStorage.getItem("workbench.panes") ?? "{}").sidebar).toBe(312);
  });

  it("collapses and expands the structure pane", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(
      <MemoryRouter initialEntries={["/novels/1"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(columns()).toContain("280px");
    });

    await user.hover(document.querySelector(".splitter") as Element);
    await user.click(screen.getByRole("button", { name: "折叠结构栏" }));

    await waitFor(() => {
      expect(columns().startsWith("0px")).toBe(true);
    });
    expect(sidebar().className).toContain("collapsed");
    expect(JSON.parse(localStorage.getItem("workbench.panes") ?? "{}").sidebarClosed).toBe(true);

    await user.click(screen.getByRole("button", { name: "展开结构栏" }));
    await waitFor(() => {
      expect(columns().startsWith("312px") || columns().startsWith("280px")).toBe(true);
    });
  });
});
