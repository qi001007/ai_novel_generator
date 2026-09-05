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

  /* 第十五批批注 2.2 - the oldest item on this list: dragging a boundary to its
     limit has to put that column away, the same way the top-bar icon does, for all
     three of them. The keyboard reaches the same code path as the pointer, and
     jsdom has no layout to drag through, so the nudges are the honest probe. */
  const hiddenAttr = () => workspace().dataset.hiddenPanels ?? "";
  const pressed = (name: string) =>
    screen.getByRole("button", { name }).getAttribute("aria-pressed");

  it("closes the tree column when its boundary is dragged past the floor", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    screen.getAllByRole("separator")[0].focus();
    await user.keyboard("{ArrowLeft}".repeat(14));

    await waitFor(() => expect(hiddenAttr()).toContain("sidebar"));
    // the top-bar icon reads the same state - one fact, two doors
    expect(pressed("显示或隐藏结构栏")).toBe("false");
    // and it does not come back as a 92px strip nobody can use
    await user.click(screen.getByRole("button", { name: "显示或隐藏结构栏" }));
    await waitFor(() => expect(columns()).toContain("260px"));
    expect(hiddenAttr()).not.toContain("sidebar");
  });

  it("closes the chat column the same way, from the same boundary", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    screen.getAllByRole("separator")[1].focus();
    await user.keyboard("{ArrowLeft}".repeat(20));

    await waitFor(() => expect(hiddenAttr()).toContain("chat"));
    expect(pressed("显示或隐藏对话栏")).toBe("false");
    // the seam of a column that is gone must not stay in the track list
    await waitFor(() =>
      expect(columns().split(" ").filter((t) => t === "1px")).toHaveLength(1),
    );
  });

  it("closes the prose column when the chat boundary is dragged over it", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    screen.getAllByRole("separator")[1].focus();
    await user.keyboard("{ArrowRight}".repeat(20));

    await waitFor(() => expect(hiddenAttr()).toContain("editor"));
    expect(pressed("显示或隐藏编辑栏")).toBe("false");
    // one column must stay standing, and the chat pane is the one that is
    expect(hiddenAttr()).not.toContain("chat");
    // no orphan splitter: hiding the editor removes its track as well
    await waitFor(() =>
      expect(columns().split(" ").filter((t) => t === "1px")).toHaveLength(1),
    );
  });

  /* 第十六批批注 9: the pointer used to be dropped the moment a column vanished, so
     pulling back moved nothing and the only way to get the column again was to let go
     and click the top-bar icon. One reversible floor now governs both directions, and
     both doors. */
  /* 16.11: two store writers used to fight over views[draftPath] - open() stamped true
     and the chapter hydration stamped false unconditionally - so a deep link into a
     draft's source showed the source while its button promised the source, and the
     first click changed nothing on screen. The flag is now written where the column is
     decided. */
  it("opens a draft's source by deep link with the toggle already facing the prose page", async () => {
    stubFetch();
    render(
      <MemoryRouter initialEntries={["/novels/1?file=chapters/0042/draft.md"]}>
        <App />
      </MemoryRouter>,
    );
    const toggle = await screen.findByRole("button", { name: "切到正文页" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    // and the surface really is the source, so the label is not lying about the future
    expect(document.querySelector(".file-cm .cm-editor")).toBeTruthy();
    expect(document.querySelector(".editor-body textarea")).toBeNull();
  });

  it("gives a closed column back from the same boundary, and not from the same direction", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    screen.getAllByRole("separator")[0].focus();
    await user.keyboard("{ArrowLeft}".repeat(14));
    await waitFor(() => expect(hiddenAttr()).toContain("sidebar"));

    // same direction again: it stays away - the idempotence 第十五批批注 2.2 pinned
    await user.keyboard("{ArrowLeft}".repeat(4));
    expect(hiddenAttr()).toContain("sidebar");

    // the other direction: back without touching the icon
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(hiddenAttr()).not.toContain("sidebar"));
    expect(pressed("显示或隐藏结构栏")).toBe("true");
    /* The track list is "44px <sidebar>px 1px ..." - the rail is first, so read the
       second one. One ArrowRight back over the floor lands just above it, which is the
       point: the column returns at the width the gesture asks for, while the icon path
       (asserted in the 第十五批 case above) still brings it back at the resting 260. */
    const tracks = columns().split(" ");
    expect(tracks[0]).toBe("44px");
    expect(tracks[1]).toMatch(/^\d+px$/);
    expect(parseInt(tracks[1], 10)).toBeGreaterThanOrEqual(90);
  });

  it("brings the prose column back the same way when the chat boundary is pulled left", async () => {
    const user = userEvent.setup();
    await openWorkbench();

    screen.getAllByRole("separator")[1].focus();
    await user.keyboard("{ArrowRight}".repeat(20));
    await waitFor(() => expect(hiddenAttr()).toContain("editor"));

    await user.keyboard("{ArrowLeft}".repeat(2));
    await waitFor(() => expect(hiddenAttr()).not.toContain("editor"));
    expect(hiddenAttr()).not.toContain("chat");
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
    expect(document.querySelector(".file-foot")).toBeNull();
  });

  it("groups chapter prose and brief files under one chapter node", async () => {
    await openWorkbench();
    await waitFor(() => {
      // The editor tab carries the same four digits now (第十六批批注 3), so this has to
      // say which 0042 it means instead of accepting whichever came first.
      expect(document.querySelector(".tree-label.mono")?.textContent).toBe("0042");
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

