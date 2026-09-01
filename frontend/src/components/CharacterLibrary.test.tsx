import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CharacterLibrary from "./CharacterLibrary";

const characters = [
  {
    id: 1,
    name: "主角",
    level: "protagonist",
    portrait: "",
    identity: "青年修士",
    goals: "寻找父亲下落",
    behavior_constraints: "",
    current_status: "",
    expected_start_chapter: 1,
    expected_end_chapter: null,
  },
  {
    id: 2,
    name: "路人甲",
    level: "extra",
    portrait: "",
    identity: "茶馆掌柜",
    goals: "",
    behavior_constraints: "",
    current_status: "",
    expected_start_chapter: 3,
    expected_end_chapter: 4,
  },
];

describe("CharacterLibrary", () => {
  it("renders character cards, filters by level, and searches", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/characters")) {
        return Promise.resolve(new Response(JSON.stringify(characters), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));

    render(<CharacterLibrary novelId={1} />);

    await waitFor(() => {
      expect(screen.getByText("主角")).toBeTruthy();
      expect(screen.getByText("路人甲")).toBeTruthy();
    });
    expect(screen.getByText("青年修士")).toBeTruthy();
    expect(screen.getByText("1 - ? 章")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "主角团" }));
    expect(screen.queryByText("路人甲")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "全部" }));
    await user.type(screen.getByLabelText("搜索人物"), "茶馆");
    expect(screen.queryByText("主角")).toBeNull();
    expect(screen.getByText("路人甲")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("attaches a portrait photo to a character", async () => {
    const user = userEvent.setup();
    const saved: { name: string; portrait: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/characters") && String(init?.method) === "POST") {
          const body = JSON.parse(String(init?.body));
          saved.push({ name: body.name, portrait: body.portrait });
          return Promise.resolve(new Response(JSON.stringify({ ...body, id: 3 }), { status: 201 }));
        }
        return Promise.resolve(new Response(JSON.stringify(characters), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }),
    );

    render(<CharacterLibrary novelId={1} />);

    await user.click(await screen.findByRole("button", { name: "新建人物" }));
    await user.type(screen.getByLabelText("姓名"), "沈砚");
    await user.upload(
      screen.getByLabelText("上传人物照片"),
      new File([new Uint8Array([137, 80, 78, 71])], "shen.png", { type: "image/png" }),
    );

    await screen.findByAltText("沈砚 照片");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(saved[0]?.portrait.startsWith("data:image/png;base64,")).toBe(true);
    });
    vi.unstubAllGlobals();
  });

  it("rejects an oversized photo", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(characters), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))));

    render(<CharacterLibrary novelId={1} />);

    await user.click(await screen.findByRole("button", { name: "新建人物" }));
    await user.upload(
      screen.getByLabelText("上传人物照片"),
      new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" }),
    );

    await screen.findByText("照片请控制在 2MB 以内");
    vi.unstubAllGlobals();
  });
});
