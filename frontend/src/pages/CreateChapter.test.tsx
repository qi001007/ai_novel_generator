import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chapter, ChapterBrief } from "../types";
import App from "../App";
import { useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";

type Server = {
  briefs: Array<{ id: number; chapter_number: number }>;
  chapters: Array<{ id: number; chapter_number: number; brief_id: number; title: string; status: string }>;
  posts: string[];
  failChapterPost: boolean;
};

function makeServer(initial: Partial<Server> = {}) {
  const server: Server = {
    briefs: [
      { id: 90, chapter_number: 42 },
      { id: 91, chapter_number: 43 },
    ],
    chapters: [{ id: 70, chapter_number: 43, brief_id: 91, title: "裂缝里的星印", status: "draft" }],
    posts: [],
    failChapterPost: false,
    ...initial,
  };
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/health")) return json({ status: "ok" });
      if (url.endsWith("/api/novels")) {
        return json([{ id: 1, title: "新建测试", description: "", target_chapters: 0, style_constraints: "", cover_image: "" }]);
      }
      if (url.includes("/llm/status")) {
        return json({ provider: "openai_compatible", configured: true, models: { chat: true }, available_models: ["MiniMax-M2.5"] });
      }

      if (url.endsWith("/api/novels/1/planning/briefs")) {
        if (method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          server.posts.push("brief");
          const made = { id: 90 + server.briefs.length, chapter_number: body.chapter_number, goal: "", events: "" };
          server.briefs.push(made);
          return json(made, 201);
        }
        return json(server.briefs);
      }
      if (url.endsWith("/api/novels/1/chapters")) {
        if (method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          server.posts.push("chapter");
          if (server.failChapterPost) return json({ detail: "chapter number already exists" }, 409);
          const made = { id: 70 + server.chapters.length, chapter_number: body.chapter_number, brief_id: body.brief_id, title: "", content: "", status: "draft" };
          server.chapters.push(made);
          return json(made, 201);
        }
        return json(server.chapters);
      }
      if (url.endsWith("/api/novels/1/files")) {
        return json([
          { path: "blueprint.md", kind: "blueprint", layer: "A", label: "全本蓝图" },
          ...server.briefs.map((b) => ({ path: `briefs/${String(b.chapter_number).padStart(4, "0")}.md`, kind: "brief", layer: "D", label: `第 ${b.chapter_number} 章简报` })),
        ]);
      }
      const briefFile = /\/files\/briefs\/(\d{4})\.md$/.exec(url);
      if (briefFile) {
        const n = Number(briefFile[1]);
        return json({
          path: `briefs/${briefFile[1]}.md`, kind: "brief", layer: "D", label: `第 ${n} 章简报`,
          text: `# 第 ${n} 章简报（D 层 · 单章简报）\n\n- **章节号**：${n}\n- **目标**：\n`,
          ai_fields: ["goal"], revision: "aaaaaaaaaaaa",
        });
      }
      if (url.includes("/files/blueprint.md")) {
        return json({ path: "blueprint.md", kind: "blueprint", layer: "A", label: "全本蓝图", text: "# A\nmain_line: ''\n", ai_fields: ["main_line"], revision: "fc7a685c0455" });
      }
      return json([]);
    }),
  );
  return server;
}

async function openWorkbench() {
  render(
    <MemoryRouter initialEntries={["/novels/1"]}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(document.querySelector(".tree-actions")).toBeTruthy();
  });
}

beforeEach(() => {
  localStorage.clear();
  useFiles.getState().reset();
  useWorkbench.setState({ selectedNovelId: null, briefs: [], chapters: [], creatingChapter: false, createError: null });
  vi.unstubAllGlobals();
});

describe("新建章节三通道", () => {
  it("树底按钮一次点击同时建出 Chapter 与简报，并自动打开该简报", async () => {
    makeServer();
    const user = userEvent.setup();
    await openWorkbench();

    await user.click(screen.getByRole("button", { name: "新建章节" }));

    await waitFor(() => {
      expect(screen.getByText("0044.md")).toBeTruthy();
    });
    expect(useWorkbench.getState().chapters.map((c) => c.chapter_number)).toEqual([43, 44]);
    expect(useWorkbench.getState().briefs.map((b) => b.chapter_number)).toEqual([42, 43, 44]);
    await waitFor(() => {
      expect(document.querySelector(".file-path")?.textContent).toContain("briefs/0044.md");
    });
  });

  it("空态里的「新建第一章」走同一个 action", async () => {
    makeServer({ briefs: [], chapters: [] });
    const user = userEvent.setup();
    await openWorkbench();

    const inline = screen.getByRole("button", { name: "新建第一章" });
    await user.click(inline);

    await waitFor(() => {
      expect(screen.getByText("0001.md")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "新建第一章" })).toBeNull();
  });

  it("Ctrl+Alt+N 与按钮等价", async () => {
    makeServer();
    const user = userEvent.setup();
    await openWorkbench();

    await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");

    await waitFor(() => {
      expect(screen.getByText("0044.md")).toBeTruthy();
    });
  });

  it("右键「单章简报」分组弹出菜单，禁用项带原因", async () => {
    makeServer({ briefs: [{ id: 90, chapter_number: 42 }], chapters: [{ id: 70, chapter_number: 42, brief_id: 90, title: "星渊碑影", status: "draft" }] });
    await openWorkbench();

    const groupRow = [...document.querySelectorAll<HTMLElement>(".tree-row")].find(
      (row) => row.textContent?.includes("单章简报"),
    ) as HTMLElement;
    fireEvent.contextMenu(groupRow);

    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toContain("新建下一章简报");
    expect(menu.textContent).toContain("Ctrl+Alt+N");

    const insert = screen.getByRole("menuitem", { name: /在其后新建章节/ });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
    expect(insert.getAttribute("title")).toContain("顺延章号");
  });

  it("后端 409 时把 detail 原文显示出来，不静默", async () => {
    makeServer({
      briefs: [{ id: 90, chapter_number: 44 }],
      failChapterPost: true,
    });
    const user = userEvent.setup();
    await openWorkbench();

    await user.click(screen.getByRole("button", { name: "新建章节" }));

    await waitFor(() => {
      expect(document.querySelector(".tree-action-error")?.textContent).toContain("chapter number already exists");
    });
    expect(useWorkbench.getState().creatingChapter).toBe(false);
  });

  it("请求飞行中三入口全 disabled，连点只建一章", async () => {
    const server = makeServer();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/api/novels/1/planning/briefs") && (init?.method ?? "GET") === "POST") {
          await gate;
        }
        return real(input as string, init);
      }),
    );

    useWorkbench.setState({
      selectedNovelId: 1,
      briefs: [{ id: 91, chapter_number: 43 } as ChapterBrief],
      chapters: [{ id: 70, chapter_number: 43, brief_id: 91, title: "", content: "", status: "draft" } as Chapter],
    });
    const first = useWorkbench.getState().createNextChapter();
    const others = await Promise.all([
      useWorkbench.getState().createNextChapter(),
      useWorkbench.getState().createNextChapter(),
      useWorkbench.getState().createNextChapter(),
    ]);
    release();
    const made = await first;

    expect(made).toBe(44);
    expect(others).toEqual([null, null, null]);
    expect(server.posts).toEqual(["brief", "chapter"]);
  });
});