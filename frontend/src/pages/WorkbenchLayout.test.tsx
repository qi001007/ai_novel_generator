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
      if (url.endsWith("/api/novels/1/chapters")) {
        return json([
          {
            id: 70,
            novel_id: 1,
            brief_id: 90,
            chapter_number: 42,
            title: "星渊碑影",
            content: "",
            word_count: 0,
            status: "ai_reviewed",
            final_decision: "",
            final_comment: "",
          },
        ]);
      }
      if (url.endsWith("/api/novels/1/files")) {
        return json([
          { path: "blueprint.md", kind: "blueprint", layer: "A", label: "全本蓝图" },
          { path: "toc.md", kind: "toc", layer: "B", label: "目录" },
          {
            path: "chapters/0042/draft.md",
            kind: "draft",
            layer: "正文",
            label: "第 42 章正文",
          },
          {
            path: "chapters/0042/brief.md",
            kind: "brief",
            layer: "D",
            label: "第 42 章简报",
          },
          {
            path: "settings/characters/1.md",
            kind: "character",
            layer: "设定",
            label: "沈曜 档案",
          },
        ]);
      }
      if (url.includes("/files/settings/characters/1.md")) {
        return json({
          path: "settings/characters/1.md",
          kind: "character",
          layer: "设定",
          label: "沈曜 档案",
          text: "# 沈曜（设定库 · 人物）\n\n## 身份\n观星少年\n",
          ai_fields: ["identity"],
          revision: "e20b3a6e5af8",
        });
      }
      if (url.includes("/files/blueprint.md")) {
        return json({
          path: "blueprint.md",
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

const SIDEBAR_DEFAULT = 300;

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
    // 帧 27: a 44px rail outside the panel, and the panel widened to 300 so the
    // rows keep the room they had before the rail took its share.
    expect(columns()).toContain("44px");
    expect(columns()).toContain("300px");
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

    // Two nudges of 16px from the default, stated as a sum rather than a literal:
    // the last time this hard-coded 312 the default moved to 300 and the test
    // failed for the wrong reason.
    const wanted = `${SIDEBAR_DEFAULT + 32}px`;
    await waitFor(() => {
      expect(columns()).toContain(wanted);
    });
    expect(JSON.parse(localStorage.getItem("workbench.panes") ?? "{}").sidebar).toBe(SIDEBAR_DEFAULT + 32);
  });

  it("keeps the separator a 1px hairline with no buttons on it", async () => {
    await openWorkbench();

    expect(columns().split(" ")).toContain("1px");
    expect(document.querySelectorAll(".splitter-toggle")).toHaveLength(0);
    const toggles = workspace().querySelectorAll(".splitter button");
    expect(toggles).toHaveLength(0);
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
    expect(screen.getByText("blueprint.md")).toBeTruthy();
    expect(document.querySelector(".file-path")?.textContent).toContain("blueprint.md");
    expect(document.querySelectorAll(".file-chip")).toHaveLength(0);
    expect(document.querySelector(".file-foot")?.textContent).not.toContain("与服务器一致");
  });

  it("groups chapter prose and brief files under one chapter node", async () => {
    await openWorkbench();
    await waitFor(() => {
      expect(screen.getByText("0042")).toBeTruthy();
    });
    expect(screen.getByText("draft.md")).toBeTruthy();
    expect(screen.getByText("brief.md")).toBeTruthy();
    expect(screen.queryByText("briefs/")).toBeNull();
  });

  it("nests the character documents under 人物 in the settings library (帧 26)", async () => {
    const user = userEvent.setup();
    await openWorkbench();
    // the panel entry stays, and the document appears under it: a new path, not a
    // replacement of the card library
    const panel = await waitFor(() => screen.getByRole("button", { name: "人物" }));
    const file = screen.getByRole("button", { name: "沈曜 · 1.md" });
    expect(file.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    await user.click(file);
    await waitFor(() => {
      expect(screen.getByText("settings/characters/1.md")).toBeTruthy();
    });
    expect(useFiles.getState().active).toBe("settings/characters/1.md");
  });
});

