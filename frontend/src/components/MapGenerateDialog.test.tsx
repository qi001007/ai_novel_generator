import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MapGenerateDialog from "./MapGenerateDialog";
import { ToastProvider } from "./ui";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ARC = {
  id: 3,
  novel_id: 1,
  title: "雾港夜航",
  start_chapter: 1,
  end_chapter: 5,
  objective: "护送信使穿过雾港",
  conflict: "",
  resolution: "",
  status: "planned",
  planned_chapters: {},
  created_at: "2026-10-20T09:00:00Z",
  updated_at: "2026-10-20T09:00:00Z",
};

const BRIEF = {
  id: 11,
  novel_id: 1,
  arc_plan_id: 3,
  chapter_number: 2,
  goal: "交出灯塔钥匙",
  events: "",
  pov: "",
  characters: [],
  conflict: "",
  hook: "",
  required_facts: [],
  status: "draft",
};

const PROJECT = {
  id: 7,
  novel_id: 1,
  name: "雾城全域图",
  status: "draft",
  revision: 1,
  active_revision: null,
  preview_url: "/api/maps/7/versions/1/image",
  created_at: "2026-10-22T09:00:00Z",
  updated_at: "2026-10-22T09:00:00Z",
  versions: [],
};

const VERSION = {
  revision: 1,
  status: "draft",
  prompt: "雾城地图",
  model: "qwen-image-3.0-pro",
  size: "1024x1536",
  request_id: "req-map-1",
  image_url: "/api/maps/7/versions/1/image",
  created_at: "2026-10-22T09:00:00Z",
};

describe("MapGenerateDialog", () => {
  it("builds the prompt from arc and brief, requires billing, then creates and generates", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const posted: { url: string; body: unknown }[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/planning/arcs")) return Promise.resolve(json([ARC]));
        if (url.endsWith("/planning/briefs")) return Promise.resolve(json([BRIEF]));
        if (url.includes("/maps/prompt")) {
          const query = new URL(url, "http://localhost").searchParams;
          return Promise.resolve(
            json({
              prompt: `提示词 arc=${query.get("arc_id") ?? "none"} chapter=${query.get("chapter_number") ?? "none"}`,
            }),
          );
        }
        if (url.endsWith("/api/novels/1/maps") && method === "POST") {
          posted.push({ url, body: JSON.parse(String(init?.body)) });
          return Promise.resolve(json(PROJECT, 201));
        }
        if (url.endsWith("/api/maps/7/versions") && method === "POST") {
          posted.push({ url, body: JSON.parse(String(init?.body)) });
          return Promise.resolve(json(VERSION));
        }
        if (url.endsWith("/api/maps/7") && method === "GET") {
          return Promise.resolve(json({ ...PROJECT, versions: [VERSION] }));
        }
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    render(
      <ToastProvider>
        <MapGenerateDialog novelId={1} onClose={vi.fn()} onDone={onDone} />
      </ToastProvider>,
    );

    expect(await screen.findByDisplayValue("提示词 arc=none chapter=none")).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: "剧情弧" }), "3");
    expect(await screen.findByDisplayValue("提示词 arc=3 chapter=none")).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: "章节简报" }), "2");
    expect(await screen.findByDisplayValue("提示词 arc=3 chapter=2")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "地图名称" }), "雾城全域图");
    await user.click(screen.getByRole("button", { name: "创建并生成" }));

    expect((await screen.findByRole("alert")).textContent).toContain("会产生费用");
    expect(posted).toHaveLength(0);

    await user.click(screen.getByRole("checkbox", { name: "确认会产生费用" }));
    await user.click(screen.getByRole("button", { name: "创建并生成" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
    expect(posted[0]).toEqual({ url: "/api/novels/1/maps", body: { name: "雾城全域图" } });
    expect(posted[1]).toEqual({
      url: "/api/maps/7/versions",
      body: { prompt: "提示词 arc=3 chapter=2", confirm_billing: true, size: "1024x1536" },
    });
  });

  it("loads the server prompt under StrictMode's double effect run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith("/planning/arcs")) return Promise.resolve(json([]));
        if (url.endsWith("/planning/briefs")) return Promise.resolve(json([]));
        if (url.includes("/maps/prompt")) return Promise.resolve(json({ prompt: "服务端拼的提示词" }));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(
      <StrictMode>
        <ToastProvider>
          <MapGenerateDialog novelId={1} onClose={vi.fn()} onDone={vi.fn()} />
        </ToastProvider>
      </StrictMode>,
    );

    expect(await screen.findByDisplayValue("服务端拼的提示词")).toBeTruthy();
  });

  it("reuses the current prompt when generating a new version", async () => {    const user = userEvent.setup();
    const onDone = vi.fn();
    const detail = {
      ...PROJECT,
      revision: 2,
      active_revision: 1,
      versions: [
        {
          revision: 2,
          status: "draft",
          prompt: "上一版提示词",
          model: "qwen-image-3.0-pro",
          size: "1024x1536",
          request_id: "req-map-2",
          image_url: "/api/maps/7/versions/2/image",
          created_at: "2026-10-22T09:00:00Z",
        },
        VERSION,
      ],
    };
    const posted: { url: string; body: unknown }[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/planning/arcs")) return Promise.resolve(json([]));
        if (url.endsWith("/planning/briefs")) return Promise.resolve(json([]));
        if (url.includes("/maps/prompt")) return Promise.resolve(json({ prompt: "服务端拼的提示词" }));
        if (url.endsWith("/api/maps/7/versions") && method === "POST") {
          posted.push({ url, body: JSON.parse(String(init?.body)) });
          return Promise.resolve(json({ ...VERSION, revision: 3 }));
        }
        if (url.endsWith("/api/maps/7") && method === "GET") return Promise.resolve(json(detail));
        return Promise.reject(new Error(`unexpected url: ${url} ${method}`));
      }),
    );

    render(
      <ToastProvider>
        <MapGenerateDialog novelId={1} project={detail} onClose={vi.fn()} onDone={onDone} />
      </ToastProvider>,
    );

    expect(screen.queryByRole("textbox", { name: "地图名称" })).toBeNull();
    const prompt = await screen.findByRole("textbox", { name: "生图提示词" });
    expect((prompt as HTMLTextAreaElement).value).toBe("上一版提示词");

    await user.click(screen.getByRole("checkbox", { name: "确认会产生费用" }));
    await user.click(screen.getByRole("button", { name: "生成新版本" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(posted[0].url).toBe("/api/maps/7/versions");
    expect(posted[0].body).toMatchObject({ confirm_billing: true, size: "1024x1536" });
  });
});
