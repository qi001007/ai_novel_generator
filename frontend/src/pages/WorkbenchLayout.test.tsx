import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { useFiles } from "../store/files";

const BLUEPRINT = "# A 层 · 全本蓝图（长期）\nmain_line: ''\n";

function stubFetch() {
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
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
          provider: "openai_compatible",
          configured: true,
          models: { chat: true },
          available_models: ["MiniMax-M2.5"],
        });
      }
      if (url.endsWith("/api/novels/1/files")) {
        return json([
          { path: "blueprint.yaml", kind: "blueprint", layer: "A", label: "全本蓝图" },
          { path: "toc.yaml", kind: "toc", layer: "B", label: "目录" },
          { path: "briefs/0042.yaml", kind: "brief", layer: "D", label: "第 42 章简报" },
        ]);
      }
      if (url.includes("/files/blueprint.yaml")) {
        return json({
          path: "blueprint.yaml",
          kind: "blueprint",
          layer: "A",
          label: "全本蓝图",
          text: BLUEPRINT,
          ai_fields: ["main_line"],
          revision: "fc7a685c0455",
        });
      }
      return json([]);
    }),
  );
}

function workspace() {
  return document.querySelector(".workspace") as HTMLElement;
}

function columns() {
  return workspace().style.gridTemplateColumns;
}

async function openWorkbench() {
  stubFetch();
  render(
    <MemoryRouter initialEntries={["/novels/1"]}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(columns()).toContain("280px");
  });
}

describe("workbench layout", () => {
  beforeEach(() => {
    localStorage.clear();
    useFiles.getState().reset();
    vi.unstubAllGlobals();
  });

  it("resizes the sidebar with the separator and persists it", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(2);

    separators[0].focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");

    await waitFor(() => {
      expect(columns()).toContain("312px");
    });
    expect(JSON.parse(localStorage.getItem("workbench.panes") ?? "{}").sidebar).toBe(312);
  });

  it("keeps the separator a 1px hairline with no buttons on it", async () => {
    await openWorkbench();

    expect(columns().split(" ")).toContain("1px");
    expect(document.querySelectorAll(".splitter-toggle")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /折叠|展开/ })).toBeNull();
  });

  it("names the model in the topbar chip", async () => {
    await openWorkbench();
    expect(document.querySelector(".model-chip")?.textContent).toContain("MiniMax-M2.5");
  });

  it("opens a planning file in the editor column", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    await user.click(screen.getByRole("button", { name: "全本蓝图" }));

    await waitFor(() => {
      expect(document.querySelector(".file-editor")).toBeTruthy();
    });
    expect(screen.getByText("blueprint.yaml")).toBeTruthy();
    expect(document.querySelector(".file-path")?.textContent).toContain("blueprint.yaml");
    expect(document.querySelector(".file-chip.mono")?.textContent).toBe("YAML");
    expect(document.querySelector(".file-foot")?.textContent).toContain("与服务器一致");
  });

  it("lists brief files plus the next chapter slot", async () => {
    await openWorkbench();
    await waitFor(() => {
      expect(screen.getByText("0042.yaml")).toBeTruthy();
    });
    expect(screen.getByText("0043.yaml")).toBeTruthy();
    expect(screen.getByText("未建")).toBeTruthy();
  });
});