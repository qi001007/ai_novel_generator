import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import PaintingDetailPanel from "./PaintingDetailPanel";
import { ToastProvider } from "./ui";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeDetail(patch: Record<string, unknown> = {}) {
  return {
    id: 7,
    novel_id: 1,
    name: "雾城全域图",
    status: "ready",
    revision: 2,
    active_revision: 1,
    preview_url: "/api/maps/7/versions/1/image",
    created_at: "2026-10-20T09:00:00Z",
    updated_at: "2026-10-21T09:00:00Z",
    versions: [
      {
        revision: 2,
        status: "draft",
        prompt: "上一版提示词",
        model: "qwen-image-3.0-pro",
        image_url: "/api/maps/7/versions/2/image",
        created_at: "2026-10-21T09:00:00Z",
      },
      {
        revision: 1,
        status: "confirmed",
        prompt: "第一版提示词",
        model: "qwen-image-3.0-pro",
        image_url: "/api/maps/7/versions/1/image",
        created_at: "2026-10-20T09:00:00Z",
      },
    ],
    ...patch,
  };
}

function tiledDetail() {
  return makeDetail({
    revision: 2,
    active_revision: 2,
    versions: [
      {
        revision: 2,
        status: "confirmed",
        prompt: "向东扩展雾城海岸",
        model: "wanx2.1-imageedit",
        size: "2048x1024",
        request_id: "req-edit-1",
        image_url: "/api/maps/7/versions/2/image",
        created_at: "2026-10-21T09:00:00Z",
        width: 2048,
        height: 1024,
        cols: 2,
        rows: 1,
        cell: 1024,
        parent_revision: 1,
        operation: { kind: "expand", edge: "east" },
      },
      {
        revision: 1,
        status: "superseded",
        prompt: "底图",
        model: "qwen-image-3.0-pro",
        size: "1024x1024",
        request_id: "req-1",
        image_url: "/api/maps/7/versions/1/image",
        created_at: "2026-10-20T09:00:00Z",
        width: 1024,
        height: 1024,
        cols: 1,
        rows: 1,
        cell: 1024,
        parent_revision: null,
        operation: {},
      },
    ],
  });
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/novels/1/artworks/7"]}>
      <ToastProvider>
        <Routes>
          <Route path="/novels/:novelId/artworks/:artworkId" element={<PaintingDetailPanel />} />
          <Route path="/novels/1" element={<p>工作台</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("PaintingDetailPanel", () => {
  it("defaults to the confirmed version and promotes a draft", async () => {
    const user = userEvent.setup();
    let current = makeDetail();
    const confirmCalls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(current));
        if (url.endsWith("/api/maps/7/versions/2/confirm") && method === "POST") {
          confirmCalls.push(url);
          current = makeDetail({ active_revision: 2, versions: [
            { ...current.versions[0], status: "confirmed" },
            { ...current.versions[1], status: "superseded" },
          ] });
          return Promise.resolve(json(current));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();

    const image = await screen.findByRole("img", { name: "雾城全域图 第 1 版" });
    expect(image.getAttribute("src")).toContain("/versions/1/image");
    expect(screen.getByText("当前确认版本")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /v2/ }));
    expect(await screen.findByRole("img", { name: "雾城全域图 第 2 版" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确认此版本" }));

    await waitFor(() => expect(confirmCalls).toHaveLength(1));
    expect(await screen.findByText("当前确认版本")).toBeTruthy();
    expect(screen.getByText(/已被替代/)).toBeTruthy();
  });

  it("renames the map and opens the new-version prompt with the last prompt", async () => {
    const user = userEvent.setup();
    let current = makeDetail();
    const putBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/planning/arcs")) return Promise.resolve(json([]));
        if (url.endsWith("/planning/briefs")) return Promise.resolve(json([]));
        if (url.includes("/maps/prompt")) return Promise.resolve(json({ prompt: "服务端拼的提示词" }));
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(current));
        if (url.endsWith("/api/maps/7") && method === "PUT") {
          const body = JSON.parse(String(init?.body));
          putBodies.push(body);
          current = makeDetail({ name: body.name });
          return Promise.resolve(json(current));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 1 版" });

    await user.click(screen.getByRole("button", { name: "重命名" }));
    const nameInput = await screen.findByRole("textbox", { name: "地图名称" });
    await user.clear(nameInput);
    await user.type(nameInput, "雾城航线图");
    await user.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(putBodies).toEqual([{ name: "雾城航线图" }]));
    expect(await screen.findByRole("heading", { name: /雾城航线图/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "生成新版本" }));
    expect(await screen.findByRole("dialog", { name: "生成新版本" })).toBeTruthy();
    expect(await screen.findByDisplayValue("上一版提示词")).toBeTruthy();
  });

  it("shows the freshly generated draft instead of the old confirmed version", async () => {
    const user = userEvent.setup();
    let current = makeDetail();
    const fresh = makeDetail({
      revision: 3,
      versions: [
        {
          revision: 3,
          status: "draft",
          prompt: "新版本提示词",
          model: "qwen-image-3.0-pro",
          size: "1024x1536",
          request_id: "req-3",
          image_url: "/api/maps/7/versions/3/image",
          created_at: "2026-10-22T09:00:00Z",
        },
        ...makeDetail().versions,
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/planning/arcs")) return Promise.resolve(json([]));
        if (url.endsWith("/planning/briefs")) return Promise.resolve(json([]));
        if (url.endsWith("/api/maps/7/versions") && method === "POST") {
          current = fresh;
          return Promise.resolve(json(fresh.versions[0]));
        }
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(current));
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 1 版" });

    await user.click(screen.getByRole("button", { name: "生成新版本" }));
    const dialog = await screen.findByRole("dialog", { name: "生成新版本" });
    await user.click(within(dialog).getByRole("checkbox", { name: "确认会产生费用" }));
    await user.click(within(dialog).getByRole("button", { name: "生成新版本" }));

    expect(await screen.findByRole("img", { name: "雾城全域图 第 3 版" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /雾城全域图 · v3/ })).toBeTruthy();
  });

  it("shows the tile grid, its history label, and the four edge controls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/maps/7") && method === "GET") {
          return Promise.resolve(json(tiledDetail()));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 2 版" });

    expect(screen.getByLabelText("地图分块")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /第 \d 列第 \d 行/ })).toHaveLength(2);
    expect(screen.getByText(/2 × 1 格 · 每格 1024 px/)).toBeTruthy();
    expect(screen.getAllByText("扩图 · 向东").length).toBeGreaterThanOrEqual(1);
    for (const name of ["向东扩展一格", "向西扩展一格", "向北扩展一格"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }

    await user.click(screen.getByRole("button", { name: "放大地图" }));
    expect(screen.getByText("63%")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "适应画布" }));
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("only expands after the cost checkbox, then shows the new draft", async () => {
    const user = userEvent.setup();
    let current = tiledDetail();
    const posts: Array<{ url: string; body: unknown }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(current));
        if (url.endsWith("/api/maps/7/expand") && method === "POST") {
          const body = JSON.parse(String(init?.body));
          posts.push({ url, body });
          current = makeDetail({
            revision: 3,
            active_revision: 2,
            versions: [
              {
                revision: 3,
                status: "draft",
                prompt: body.prompt,
                model: "wanx2.1-imageedit",
                size: "3072x1024",
                request_id: "req-edit-2",
                image_url: "/api/maps/7/versions/3/image",
                created_at: "2026-10-22T09:00:00Z",
                width: 3072,
                height: 1024,
                cols: 3,
                rows: 1,
                cell: 1024,
                parent_revision: 2,
                operation: { kind: "expand", edge: "east" },
              },
              ...tiledDetail().versions,
            ],
          });
          return Promise.resolve(json(current));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 2 版" });
    await user.click(screen.getByRole("button", { name: "向东扩展一格" }));

    const dialog = await screen.findByRole("dialog", { name: "扩图 · 向东" });
    await user.type(within(dialog).getByRole("textbox", { name: "扩图提示词" }), "海岸向东延伸");
    await user.click(within(dialog).getByRole("button", { name: "确认扩图" }));

    expect(await within(dialog).findByText("扩图会产生费用，请先勾选确认")).toBeTruthy();
    expect(posts).toEqual([]);

    await user.click(within(dialog).getByRole("checkbox", { name: "确认会产生费用" }));
    await user.click(within(dialog).getByRole("button", { name: "确认扩图" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/maps/7/expand",
      body: {
        parent_revision: 2,
        edge: "east",
        prompt: "海岸向东延伸",
        confirm_billing: true,
      },
    });
    expect(await screen.findByRole("heading", { name: /雾城全域图 · v3/ })).toBeTruthy();
    expect(screen.getByText(/3 × 1 格 · 每格 1024 px/)).toBeTruthy();
  });

  it("regenerates only the cell the author selected", async () => {
    const user = userEvent.setup();
    let current = makeDetail({
      revision: 1,
      active_revision: 1,
      versions: [
        {
          revision: 1,
          status: "confirmed",
          prompt: "四方底图",
          model: "qwen-image-3.0-pro",
          size: "2048x2048",
          request_id: "req-1",
          image_url: "/api/maps/7/versions/1/image",
          created_at: "2026-10-20T09:00:00Z",
          width: 2048,
          height: 2048,
          cols: 2,
          rows: 2,
          cell: 1024,
          parent_revision: null,
          operation: {},
        },
      ],
    });
    const posts: Array<{ url: string; body: unknown }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(current));
        if (url.endsWith("/api/maps/7/cells/1/1/regenerate") && method === "POST") {
          posts.push({ url, body: JSON.parse(String(init?.body)) });
          return Promise.resolve(json(current));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 1 版" });
    await user.click(screen.getByRole("button", { name: "第 2 列第 2 行" }));

    expect(screen.getByRole("button", { name: "第 2 列第 2 行" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "重绘这一格" }));

    const dialog = await screen.findByRole("dialog", { name: "重绘 · 第 2 列第 2 行" });
    expect((within(dialog).getByRole("textbox", { name: "扩图提示词" }) as HTMLTextAreaElement).value).toBe(
      "四方底图",
    );
    await user.click(within(dialog).getByRole("checkbox", { name: "确认会产生费用" }));
    await user.click(within(dialog).getByRole("button", { name: "确认重绘" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/maps/7/cells/1/1/regenerate",
      body: { parent_revision: 1, prompt: "四方底图", confirm_billing: true },
    });
  });

  it("explains why a non-tiled image cannot expand", async () => {
    const portrait = makeDetail({
      revision: 1,
      active_revision: 1,
      versions: [
        {
          revision: 1,
          status: "confirmed",
          prompt: "竖幅地图",
          model: "qwen-image-3.0-pro",
          size: "1024x1536",
          request_id: "req-1",
          image_url: "/api/maps/7/versions/1/image",
          created_at: "2026-10-20T09:00:00Z",
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/api/maps/7")
          ? Promise.resolve(json(portrait))
          : Promise.reject(new Error(`unexpected ${String(input)}`)),
      ),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 1 版" });

    expect(screen.getByText(/不是 1024 对齐的方形画布/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "向东扩展一格" })).toBeNull();
  });

  it("disables every edge once the canvas is four by four", async () => {
    const full = makeDetail({
      revision: 1,
      active_revision: 1,
      versions: [
        {
          revision: 1,
          status: "confirmed",
          prompt: "满格地图",
          model: "qwen-image-3.0-pro",
          size: "4096x4096",
          request_id: "req-1",
          image_url: "/api/maps/7/versions/1/image",
          created_at: "2026-10-20T09:00:00Z",
          width: 4096,
          height: 4096,
          cols: 4,
          rows: 4,
          cell: 1024,
          parent_revision: null,
          operation: {},
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/api/maps/7")
          ? Promise.resolve(json(full))
          : Promise.reject(new Error(`unexpected ${String(input)}`)),
      ),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 1 版" });

    for (const name of [
      "向东扩展一格",
      "向西扩展一格",
      "向北扩展一格",
      "向南扩展一格",
    ]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("deletes the map after confirmation and returns to the workbench", async () => {
    const user = userEvent.setup();
    const deletes: string[] = [];
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(makeDetail()));
        if (url.endsWith("/api/maps/7") && method === "DELETE") {
          deletes.push(url);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    renderDetail();
    await screen.findByRole("img", { name: "雾城全域图 第 1 版" });

    await user.click(screen.getByRole("button", { name: "删除地图" }));

    await waitFor(() => expect(deletes).toEqual(["/api/maps/7"]));
    expect(await screen.findByText("工作台")).toBeTruthy();
  });
});
