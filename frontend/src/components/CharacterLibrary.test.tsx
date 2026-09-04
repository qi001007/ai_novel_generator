import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CharacterLibrary from "./CharacterLibrary";
import { useFiles } from "../store/files";

const CHARACTER_DOC = [
  "# 沈曜（设定库 · 人物）",
  "",
  "> 文件名人物号即主键。",
  "",
  "- **姓名**：沈曜",
  "- **分级**：protagonist",
  "- **起始章**：1",
  "- **结束章**：—",
  "",
  "## 身份",
  "",
  "编辑器里改过的身份",
  "",
  "## 目标",
  "",
  "编辑器里改过的目标",
  "",
].join("\n");

const fileOk = {
  path: "settings/characters/1.md",
  kind: "character",
  layer: "设定",
  label: "沈曜 档案",
  text: CHARACTER_DOC,
  ai_fields: [],
  revision: "rev-doc",
};

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
  beforeEach(() => {
    useFiles.setState({
      novelId: null,
      metas: [],
      tabs: [],
      active: null,
      entries: {},
      pending: {},
      jump: null,
      focus: null,
      revealSeq: 0,
    });
  });

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

  it("lays the card out per frame 08: avatar, name over range, badge, identity", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(characters), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))));

    const { container } = render(<CharacterLibrary novelId={1} />);

    await waitFor(() => expect(container.querySelector(".character-card")).toBeTruthy());
    const card = container.querySelector(".character-card") as HTMLElement;
    const cardHead = card.querySelector(".card-head") as HTMLElement;
    // avatar + (name over range) + badge share one row; identity is its own row.
    expect(cardHead.querySelector(".avatar")).toBeTruthy();
    expect(cardHead.querySelector(".card-name")).toBeTruthy();
    expect(cardHead.querySelector(".card-range")).toBeTruthy();
    expect(cardHead.querySelector(".level-badge")).toBeTruthy();
    expect(card.querySelector(".card-head .card-identity")).toBeNull();
    expect(card.querySelector(":scope > .card-identity")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("saves through the file layer, and the photo through the asset endpoint (D-15)", async () => {
    const user = userEvent.setup();
    const blankDoc = [
      "# 新人物（设定库 · 人物）",
      "",
      "> 文件名人物号即主键：改名不换路径。小节标题与字段名是结构标识，不可增删改名。",
      "",
      "- **姓名**：—",
      "- **分级**：—",
      "- **起始章**：—",
      "- **结束章**：—",
      "",
      "## 身份",
      "",
      "## 目标",
      "",
      "## 行为约束",
      "",
      "## 当前状态",
      "",
    ].join("\n");
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = String(init?.method ?? "GET");
        if (url.endsWith("/files/settings/characters/new.md") && method === "GET") {
          return Promise.resolve(ok({
            path: "settings/characters/new.md", kind: "character", layer: "设定",
            label: "新人物 档案", text: blankDoc, ai_fields: [], revision: "rev-0",
          }));
        }
        if (url.endsWith("/files/settings/characters/new.md") && method === "PUT") {
          writes.push({ path: "file", body: JSON.parse(String(init?.body)) });
          // the server reports the numeric path the create actually landed on
          return Promise.resolve(ok({ path: "settings/characters/7.md", changed: ["name"], revision: "rev-1" }));
        }
        if (url.endsWith("/characters/7/portrait") && method === "PUT") {
          writes.push({ path: "portrait", body: JSON.parse(String(init?.body)) });
          return Promise.resolve(ok({ ...characters[0], id: 7 }));
        }
        if (url.includes("/api/novels/1/characters")) return Promise.resolve(ok(characters));
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
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

    await waitFor(() => expect(writes.length).toBe(2));
    // content goes through the one file-layer writer, as a human edit, with the
    // revision we read, so a concurrent agent write cannot be clobbered
    expect(writes[0].path).toBe("file");
    const text = String(writes[0].body.text);
    expect(text).toContain("- **姓名**：沈砚");
    expect(writes[0].body.actor).toBe("human");
    expect(writes[0].body.base_revision).toBe("rev-0");
    // the base64 asset never enters that document; it has its own narrow endpoint
    expect(text).not.toContain("base64");
    expect(writes[1].path).toBe("portrait");
    expect(String(writes[1].body.portrait).startsWith("data:image/png;base64,")).toBe(true);
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

  it("shows the four long fields as read-only previews with a pencil (帧 26)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(characters), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))));

    const { container } = render(<CharacterLibrary novelId={1} />);
    await user.click(await screen.findByRole("button", { name: /主角/ }));

    const modal = container.querySelector(".character-modal") as HTMLElement;
    // no input or textarea is left for a long field: the snapshot must not edit them
    expect(within(modal).queryByLabelText("身份")).toBeNull();
    expect(within(modal).queryByLabelText("目标")).toBeNull();
    expect(within(modal).queryByLabelText("行为约束")).toBeNull();
    expect(within(modal).queryByLabelText("当前状态")).toBeNull();
    expect(modal.querySelectorAll(".long-field")).toHaveLength(4);
    expect(modal.querySelectorAll("button.long-field-edit")).toHaveLength(4);
    // the value is shown, and a missing one shows a dash instead of an invented text
    const texts = [...modal.querySelectorAll(".long-field-text")].map((n) => n.textContent);
    expect(texts).toEqual(["青年修士", "寻找父亲下落", "—", "—"]);
    // the short fields keep their inputs
    expect(within(modal).getByLabelText("姓名")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("hands a long field to the file editor, parked on that section", async () => {
    const user = userEvent.setup();
    useFiles.setState({ novelId: 1 });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/files/settings/characters/1.md")) {
        return Promise.resolve(new Response(JSON.stringify(fileOk), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify(characters), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }));

    const { container } = render(<CharacterLibrary novelId={1} />);
    await user.click(await screen.findByRole("button", { name: /主角/ }));
    const modal = container.querySelector(".character-modal") as HTMLElement;

    await user.click(within(modal).getByRole("button", { name: "在文件中编辑目标" }));

    await waitFor(() => expect(useFiles.getState().active).toBe("settings/characters/1.md"));
    expect(useFiles.getState().focus).toMatchObject({
      path: "settings/characters/1.md",
      field: "goals",
    });
    vi.unstubAllGlobals();
  });

  it("leaves the sections the editor owns alone when the modal saves (no stale overwrite)", async () => {
    const user = userEvent.setup();
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = String(init?.method ?? "GET");
      const ok = (data: unknown) =>
        new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/files/settings/characters/1.md") && method === "GET") return Promise.resolve(ok(fileOk));
      if (url.endsWith("/files/settings/characters/1.md") && method === "PUT") {
        writes.push(String(JSON.parse(String(init?.body)).text));
        return Promise.resolve(ok({ path: "settings/characters/1.md", changed: ["name"], revision: "rev-1" }));
      }
      return Promise.resolve(ok(characters));
    }));

    const { container } = render(<CharacterLibrary novelId={1} />);
    await user.click(await screen.findByRole("button", { name: /主角/ }));
    const modal = container.querySelector(".character-modal") as HTMLElement;
    // the snapshot still carries the identity it read when the card was opened
    expect(modal.textContent).toContain("青年修士");
    await user.click(within(modal).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(writes.length).toBe(1));
    // the document's own sections survive the write; the stale snapshot never lands
    expect(writes[0]).toContain("编辑器里改过的身份");
    expect(writes[0]).not.toContain("青年修士");
    vi.unstubAllGlobals();
  });

  it("has nowhere to jump to before a new character has been saved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(characters), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))));

    const { container } = render(<CharacterLibrary novelId={1} />);
    await user.click(await screen.findByRole("button", { name: "新建人物" }));
    const modal = container.querySelector(".character-modal") as HTMLElement;

    const pencils = [...modal.querySelectorAll("button.long-field-edit")] as HTMLButtonElement[];
    expect(pencils).toHaveLength(4);
    expect(pencils.every((button) => button.disabled)).toBe(true);
    expect(pencils[0].title).toContain("先保存");
    vi.unstubAllGlobals();
  });
});

