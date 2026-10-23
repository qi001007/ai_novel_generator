import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import WorldMapPanel from "./WorldMapPanel";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MAPS = [
  {
    id: 7,
    novel_id: 1,
    name: "雾城全域图",
    status: "ready",
    revision: 2,
    active_revision: 1,
    preview_url: "/api/maps/7/versions/1/image",
    created_at: "2026-10-20T09:00:00Z",
    updated_at: "2026-10-21T09:00:00Z",
  },
  {
    id: 8,
    novel_id: 1,
    name: "北境航线图",
    status: "draft",
    revision: 0,
    active_revision: null,
    preview_url: null,
    created_at: "2026-10-22T09:00:00Z",
    updated_at: "2026-10-22T09:00:00Z",
  },
];

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/novels/1"]}>
      <Routes>
        <Route path="/novels/1" element={<WorldMapPanel novelId={1} />} />
        <Route path="/novels/1/artworks/:artworkId" element={<p>地图详情页</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorldMapPanel", () => {
  it("lists real map projects and opens their detail route", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith("/api/novels/1/maps")) return Promise.resolve(json(MAPS));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    renderPanel();

    expect(await screen.findByText("雾城全域图")).toBeTruthy();
    expect(screen.getByText("已确认 v1")).toBeTruthy();
    expect(screen.getByText("还没有生成版本")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /雾城全域图/ }));
    expect(screen.getByText("地图详情页")).toBeTruthy();
  });

  it("starts the first generation from the empty state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith("/api/novels/1/maps")) return Promise.resolve(json([]));
        if (url.endsWith("/planning/arcs")) return Promise.resolve(json([]));
        if (url.endsWith("/planning/briefs")) return Promise.resolve(json([]));
        if (url.includes("/maps/prompt")) {
          return Promise.resolve(json({ prompt: "请为《雾城》绘制一张世界地图。" }));
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    renderPanel();

    await user.click(await screen.findByRole("button", { name: "生成第一张地图" }));
    expect(await screen.findByRole("dialog", { name: "生成世界观地图" })).toBeTruthy();
    expect(await screen.findByDisplayValue("请为《雾城》绘制一张世界地图。")).toBeTruthy();
  });
});
