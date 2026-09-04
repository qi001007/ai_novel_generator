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
  writes: string[];
  failWrite: boolean;
};

function briefPath(n: number) {
  return `chapters/${String(n).padStart(4, "0")}/brief.md`;
}

function makeServer(initial: Partial<Server> = {}) {
  const server: Server = {
    briefs: [
      { id: 90, chapter_number: 42 },
      { id: 91, chapter_number: 43 },
    ],
    chapters: [{ id: 70, chapter_number: 43, brief_id: 91, title: "裂缝里的星印", status: "draft" }],
    writes: [],
    failWrite: false,
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
        if (method !== "GET") return json({ detail: "四层规划写入口已收口到 PUT /files/{path}" }, 410);
        return json(server.briefs);
      }
      if (url.endsWith("/api/novels/1/chapters")) {
        return json(server.chapters);
      }
      if (url.endsWith("/api/novels/1/files")) {
        return json([
          { path: "blueprint.md", kind: "blueprint", layer: "A", label: "全本蓝图" },
          ...server.chapters.map((chapter) => ({
            path: `chapters/${String(chapter.chapter_number).padStart(4, "0")}/draft.md`,
            kind: "draft",
            layer: "正文",
            label: `第 ${chapter.chapter_number} 章正文`,
          })),
          ...server.briefs.map((brief) => ({
            path: briefPath(brief.chapter_number),
            kind: "brief",
            layer: "D",
            label: `第 ${brief.chapter_number} 章简报`,
          })),
        ]);
      }

      const briefFile = /\/files\/chapters\/(\d{4})\/brief\.md$/.exec(url);
      if (briefFile) {
        const n = Number(briefFile[1]);
        const text = `# 第 ${n} 章简报（D 层 · 单章简报）\n\n- **章节号**：${n}\n- **所属弧**：—\n- **视角**：—\n- **出场人物**：\n- **状态**：draft\n\n## 目标\n\n## 事件\n\n## 冲突\n\n## 钩子\n\n## 既定事实\n`;
        if (method === "PUT") {
          server.writes.push("brief+chapter");
          if (server.failWrite) return json({ detail: "chapter number already exists" }, 409);
          if (!server.briefs.some((item) => item.chapter_number === n)) {
            server.briefs.push({ id: 90 + server.briefs.length, chapter_number: n });
          }
          if (!server.chapters.some((item) => item.chapter_number === n)) {
            server.chapters.push({
              id: 70 + server.chapters.length,
              chapter_number: n,
              brief_id: server.briefs.find((item) => item.chapter_number === n)!.id,
              title: "",
              status: "draft",
            });
          }
          return json({ path: briefPath(n), changed: ["brief.created", "chapter.created"], revision: "bbbbbbbbbbbb" });
        }
        return json({
          path: briefPath(n),
          kind: "brief",
          layer: "D",
          label: `第 ${n} 章简报`,
          text,
          ai_fields: ["goal"],
          revision: "aaaaaaaaaaaa",
        });
      }
      if (url.includes("/files/blueprint.md")) {
        return json({ path: "blueprint.md", kind: "blueprint", layer: "A", label: "全本蓝图", text: "# A\n", ai_fields: ["main_line"], revision: "fc7a685c0455" });
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
    // The footer bar is gone (帧 27); the page header is what says the tree is up.
    expect(document.querySelector(".tree-page-head")).toBeTruthy();
  });
}

beforeEach(() => {
  localStorage.clear();
  useFiles.getState().reset();
  useWorkbench.setState({ selectedNovelId: null, briefs: [], chapters: [], creatingChapter: false, createError: null });
  vi.unstubAllGlobals();
});

describe("新建章节三通道", () => {
  it("页头的加号图标一次文件写入同事务建出 Chapter 与简报，并打开该简报", async () => {
    const server = makeServer();
    const user = userEvent.setup();
    await openWorkbench();

    await user.click(screen.getByRole("button", { name: "新建章节" }));

    await waitFor(() => {
      expect(screen.getByText("0044")).toBeTruthy();
    });
    expect(server.writes).toEqual(["brief+chapter"]);
    expect(useWorkbench.getState().chapters.map((chapter) => chapter.chapter_number)).toEqual([43, 44]);
    expect(useWorkbench.getState().briefs.map((brief) => brief.chapter_number)).toEqual([42, 43, 44]);
    await waitFor(() => {
      expect(document.querySelector(".file-path")?.textContent).toContain("chapters/0044/brief.md");
    });
  });

  it("空态里的「新建第一章」走同一个 action", async () => {
    makeServer({ briefs: [], chapters: [] });
    const user = userEvent.setup();
    await openWorkbench();

    const inline = screen.getByRole("button", { name: "新建第一章" });
    await user.click(inline);

    await waitFor(() => {
      expect(screen.getByText("0001")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "新建第一章" })).toBeNull();
  });

  it("Ctrl+Alt+N 与按钮等价", async () => {
    makeServer();
    const user = userEvent.setup();
    await openWorkbench();

    await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");

    await waitFor(() => {
      expect(screen.getByText("0044")).toBeTruthy();
    });
  });

  it("右键章节目录弹出菜单，禁用项带原因", async () => {
    makeServer({ briefs: [{ id: 90, chapter_number: 42 }], chapters: [{ id: 70, chapter_number: 42, brief_id: 90, title: "星渊碑影", status: "draft" }] });
    await openWorkbench();

    const chapterRow = [...document.querySelectorAll<HTMLElement>(".tree-row")].find(
      (row) => row.textContent?.includes("0042"),
    ) as HTMLElement;
    fireEvent.contextMenu(chapterRow);

    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toContain("新建下一章简报");
    expect(menu.textContent).toContain("Ctrl+Alt+N");

    const insert = screen.getByRole("menuitem", { name: /在其后新建章节/ });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
    expect(insert.getAttribute("title")).toContain("顺延章号");
  });

  it("后端 409 时把 detail 原文显示出来，不静默", async () => {
    makeServer({ failWrite: true });
    const user = userEvent.setup();
    await openWorkbench();

    await user.click(screen.getByRole("button", { name: "新建章节" }));

    await waitFor(() => {
      expect(document.querySelector(".tree-action-error")?.textContent).toContain("chapter number already exists");
    });
    expect(useWorkbench.getState().creatingChapter).toBe(false);
  });

  it("请求飞行中三入口全 disabled，连点只发一次写入", async () => {
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
        if (url.endsWith("/files/chapters/0044/brief.md") && (init?.method ?? "GET") === "PUT") {
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
    expect(server.writes).toEqual(["brief+chapter"]);
  });
});
