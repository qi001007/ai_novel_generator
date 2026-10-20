import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFiles } from "../store/files";
import WorldviewPanel from "./WorldviewPanel";

const ENTRIES = [
  { id: 1, name: "星渊碑", category: "地点", is_confirmed: true, source_chapter: 8, current_state: "仍在雪原", content: "碑文只在雪夜显现", custom_sections: [], created_at: "2026-10-18T09:00:00Z", updated_at: "2026-10-18T09:00:00Z" },
  { id: 2, name: "三律", category: "规则", is_confirmed: false, source_chapter: 2, current_state: "尚未确认", content: "不得逆转已死之人", custom_sections: [], created_at: "2026-10-19T09:00:00Z", updated_at: "2026-10-19T09:00:00Z" },
];

describe("WorldviewPanel", () => {
  let openFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openFile = vi.fn();
    useFiles.getState().reset();
    useFiles.setState({ open: openFile });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(ENTRIES), { status: 200, headers: { "Content-Type": "application/json" } }))));
  });

  it("searches entries and keeps the detail aligned with the visible result", async () => {
    const user = userEvent.setup();
    render(<WorldviewPanel novelId={1} path="settings/worldview.md" />);

    const panel = await screen.findByRole("region", { name: "世界观资料库" });
    await user.type(within(panel).getByRole("searchbox", { name: "搜索世界观" }), "三律");

    const rows = within(within(panel).getByRole("list", { name: "世界观条目" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("三律");
    await waitFor(() => expect(within(panel).getByRole("heading", { name: "三律" })).toBeTruthy());
    expect(within(panel).getByText("不得逆转已死之人")).toBeTruthy();
  });

  it("filters by approval state and opens the single Markdown write source", async () => {
    render(<WorldviewPanel novelId={1} path="settings/worldview.md" />);
    const panel = await screen.findByRole("region", { name: "世界观资料库" });

    fireEvent.click(within(panel).getByRole("button", { name: "世界观审批状态" }));
    fireEvent.click(within(panel).getByRole("option", { name: "已确认" }));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(within(panel).getByRole("button", { name: /编辑源文件/ }));
    expect(openFile).toHaveBeenCalledWith("settings/worldview.md");
  });
});
