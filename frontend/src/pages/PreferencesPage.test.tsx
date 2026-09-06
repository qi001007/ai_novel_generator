import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PreferencesPage from "./PreferencesPage";

const config = {
  provider: "openai_compatible",
  api_base_url: "https://gateway.example/v1",
  timeout: 120,
  models: { draft: "Model-A", review: "Model-A", summary: "", chat: "", image: "" },
  api_key_masked: "****9876",
  api_key_set: true,
  configured: true,
  // 第十九批批注 2: a legacy install reads back as exactly one default provider, so the
  // page has something to render before anyone adds a second one.
  providers: [
    {
      id: "default",
      name: "默认",
      provider: "openai_compatible",
      api_base_url: "https://gateway.example/v1",
      api_key_masked: "****9876",
      api_key_set: true,
      is_default: true,
    },
  ],
  routes: { draft: "default", review: "default", summary: "default", chat: "default", image: "default" },
  tasks: ["draft", "review", "summary", "chat", "image"],
};

function stubFetch(calls: { method: string; url: string; body: unknown }[]) {
  const ok = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/api/config/llm/test")) {
        return Promise.resolve(ok({ ok: true, detail: "连接正常（HTTP 200）" }));
      }
      return Promise.resolve(ok(config));
    }),
  );
}

describe("PreferencesPage", () => {
  let calls: { method: string; url: string; body: unknown }[] = [];

  beforeEach(() => {
    calls = [];
  });

  it("shows the model-access form with the key masked, never in full", async () => {
    stubFetch(calls);
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );

    const key = (await screen.findByLabelText("API Key")) as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.value).toBe("");
    // the placeholder may reveal the tail, nothing more
    expect(key.placeholder).toContain("****9876");
    expect(key.placeholder).not.toContain("98769");
    expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe(
      "https://gateway.example/v1",
    );
    expect((screen.getByLabelText("正文生成模型") as HTMLInputElement).value).toBe("Model-A");
  });

  it("sends what the owner typed and leaves the key alone when the box is blank", async () => {
    const user = userEvent.setup();
    stubFetch(calls);
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );

    await screen.findByLabelText("API Key");
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "https://other.example/v1");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === "PUT").length).toBe(1);
    });
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/config/llm");
    expect(put?.body).toEqual({
      api_base_url: "https://other.example/v1",
      api_key: "",
      timeout: 120,
      models: config.models,
      providers: [],
      routes: config.routes,
    });
  });

  /* 第十九批批注 2: 「正文用 A 家、审稿用 B 家」must be expressible from the page, not
     only in the database. */
  it("adds a second provider and routes one task at it", async () => {
    const user = userEvent.setup();
    stubFetch(calls);
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );

    await screen.findByLabelText("API Key");
    await user.click(screen.getByRole("button", { name: "添加供应商" }));
    await user.type(screen.getByLabelText("供应商 1 名称"), "B 家");
    await user.type(
      screen.getByLabelText("供应商 1 Base URL"),
      "https://b.example/v1",
    );
    await user.type(screen.getByLabelText("供应商 1 API Key"), "key-b");

    const route = await screen.findByLabelText("审稿使用的供应商");
    await user.selectOptions(route, "p1");
    expect((route as HTMLSelectElement).value).toBe("p1");
    // the other tasks stay on the default gateway - routing is per task, not global
    expect((screen.getByLabelText("正文生成使用的供应商") as HTMLSelectElement).value).toBe("default");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const put = calls.filter((call) => call.method === "PUT").pop();
      expect(put?.body).toMatchObject({
        providers: [{ id: "p1", name: "B 家", api_base_url: "https://b.example/v1" }],
        routes: { review: "p1", draft: "default" },
      });
    });
  });

  it("sends the image slot as a task with a provider of its own", async () => {
    stubFetch(calls);
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );
    const image = await screen.findByLabelText("生图（未启用）使用的供应商");
    expect((image as HTMLSelectElement).value).toBe("default");
    const model = screen.getByLabelText("生图（未启用）模型") as HTMLInputElement;
    expect(model.value).toBe("");
    // reserved, not wired: the row says so instead of hiding or faking a control
    expect(model.placeholder).toBe("未启用");
  });

  /* 第二十五批批注 5：撤销入口。三种恢复语义是他逐条给的，
     所以这条测试把三条都走一遍：放回书里（书没了要如实报错）、
     只取文件（先弹「要不要连书一起恢复」）、恢复整本书。 */
  it("lists deletions and offers the three ways back", async () => {
    const user = userEvent.setup();
    const calls: { method: string; url: string; body: unknown }[] = [];
    const snapshot = {
      file: "deleted-20260906-161335-7-演练.db",
      reason: "删除前",
      taken_at: "2026-09-06 16:13:35",
      novel_id: 7,
      title: "演练",
      bytes: 434176,
    };
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ method: String(init?.method ?? "GET"), url, body: null });
        if (url.startsWith("/api/export/settings")) return ok({ export_dir: "" });
        if (url.startsWith("/api/backups/documents")) {
          return ok([{ novel_id: 7, novel_title: "演练", path: "blueprint.md", label: "全书蓝图" }]);
        }
        if (url.startsWith("/api/backups/restore/document")) {
          const body = JSON.parse(String(init?.body));
          if (body.into === "book") {
            return Promise.resolve(
              new Response(JSON.stringify({ detail: "这本书已经不在书架上了" }), {
                status: 409,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
          return ok({ result: { restored: "dir", saved_to: "E:\\exports\\演练_全书蓝图.md" } });
        }
        if (url.startsWith("/api/backups/restore/novel")) {
          return ok({ result: { novel_id: 7, title: "演练", rows: 3 } });
        }
        if (url === "/api/novels") {
          return ok([{ id: 7, title: "演练", description: "", target_chapters: 0, style_constraints: "", cover_image: "" }]);
        }
        if (url.startsWith("/api/backups")) return ok({ export_dir: "", snapshots: [snapshot] });
        return ok(config);
      }),
    );

    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "导出与恢复" }));

    // 第二十六批批注 1、4：一行一项，标题与说明在左、动作在右（复用外观那组的 .pref-row）
    const group = (await screen.findByText("《演练》")).closest(".storage-group") as HTMLElement;
    expect(group.textContent).toContain("09-06 16:13");
    expect(group.querySelector(".pref-row-label")).toBeTruthy();
    // 说明文字必须短（每句 <= 22 字），且不许出现上一版那段 62 字的话
    const notes = [...document.querySelectorAll(".pref-row-note")].map((n) => n.textContent ?? "");
    for (const note of notes) expect(note.length, note).toBeLessThanOrEqual(22);
    expect(document.body.textContent).not.toContain("全书、单章与每一份文档的导出都写到这个目录");

    // ① 放回书里：书已经没了，就如实报错，不假装成功
    await user.click(screen.getByRole("button", { name: "取一个文件" }));
    await screen.findByText("全书蓝图");
    await screen.findByText("blueprint.md");
    await user.click(screen.getByRole("button", { name: "放回书里" }));
    expect(await screen.findByText("这本书已经不在书架上了")).toBeTruthy();

    // ② 只取这个文件：先问他要不要连整本书一起恢复
    await user.click(screen.getByRole("button", { name: "只取文件" }));
    const dialog = await screen.findByRole("dialog", { name: "恢复方式" });
    // 标题直接点名是哪本书，说明只留一句
    expect(dialog.textContent).toContain("《演练》已经不在书架上");
    expect(dialog.querySelector(".book-delete-note")?.textContent).toBe("只取文件就不动书架");
    await user.click(within(dialog).getByRole("button", { name: "只取文件" }));
    // 批注 3：回执必须报完整路径 - 后端本来就给了 saved_to，是我上一版把它丢了
    expect(
      await screen.findByText("已写到 E:\\exports\\演练_全书蓝图.md"),
    ).toBeTruthy();
    expect(calls.some((call) => call.url.startsWith("/api/backups/restore/document"))).toBe(true);

    // ③ 恢复整本书
    await user.click(screen.getByRole("button", { name: "恢复整本书" }));
    // 状态行就在那一行下面，不必再把书名重复一遍
    expect(await screen.findByText("已回到书架")).toBeTruthy();
    // 第二十六批批注 2：恢复是后端干的活，本地那份 novels 数组不重读就永远看不见它。
    // 关键不是「有没有读」而是「读在恢复之后」- 读早了拿到的还是没有这本书的那份。
    await waitFor(() => {
      const restoredAt = calls.findIndex((call) => call.url.startsWith("/api/backups/restore/novel"));
      const reads = calls.filter((call) => call.method === "GET" && call.url === "/api/novels");
      // 不用 findLastIndex：本项目的 lib 目标里没有它（写完这一条才 tsc 才发现）
      const readAt = reads.length ? calls.indexOf(reads[reads.length - 1]) : -1;
      expect(restoredAt).toBeGreaterThan(-1);
      expect(readAt).toBeGreaterThan(restoredAt);
    });
  });

  it("runs the connection test against the backend, not a model", async () => {
    const user = userEvent.setup();
    stubFetch(calls);
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );

    await screen.findByLabelText("API Key");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith("/api/config/llm/test"))).toBe(true);
    });
    expect(await screen.findByText("连接正常（HTTP 200）")).toBeTruthy();
  });

  /* 设置页结构：左列表 + 右入口。加一项设置应当只是往表里添一条，
     而列表与面板不许把同一个词说两遍（§0.7 条六）。 */
  it("is a list on the left with one group open on the right", async () => {
    const user = userEvent.setup();
    stubFetch(calls);
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );
    const nav = await screen.findByRole("tablist", { name: "设置项" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["模型接入", "外观", "导出与恢复"]);
    // only the selected group is on screen
    expect(await screen.findByLabelText("API Key")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "浅色" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "外观" }));
    expect(await screen.findByRole("radio", { name: "浅色" })).toBeTruthy();
    expect(screen.queryByLabelText("API Key")).toBeNull();

    // the group name is stated once, not in the list and again as a panel heading
    expect(nav.ownerDocument.querySelectorAll(`[aria-labelledby="prefs-tab-appearance"]`)).toHaveLength(1);
    expect(screen.getAllByText("外观")).toHaveLength(1);
    expect(document.querySelector(".prefs-panel h2")).toBeNull();
  });

  /* 第十九批批注 3 立的是「看样挑选」，第二十批批注 5 把它收回到该看图的地方：
     只有主题是卡片，其余一行一项。这里钉的是点下去有东西在换、换得下来。 */
  it("switches look, colour, sizes and fonts, and remembers all eight", async () => {
    const user = userEvent.setup();
    stubFetch(calls);
    localStorage.clear();
    render(
      <MemoryRouter>
        <PreferencesPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "外观" }));

    expect(screen.getAllByRole("radiogroup").map((item) => item.getAttribute("aria-label"))).toEqual([
      "主题",
      "强调色",
      "代码配色",
    ]);
    const cards = screen
      .getByRole("radiogroup", { name: "主题" })
      .querySelectorAll(`[role="radio"]`);
    expect(cards).toHaveLength(3);
    // 主题卡里仍是一格微缩界面，不是一块纯色
    expect(cards[2].querySelector(".pv-line.accent")).toBeTruthy();
    expect(cards[2].getAttribute("data-theme") ?? cards[2].querySelector(".pref-preview")?.getAttribute("data-theme")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: "深色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(screen.getByRole("radio", { name: "蓝" }));
    expect(document.documentElement.dataset.accent).toBe("blue");
    await user.click(screen.getByRole("radio", { name: "石墨" }));
    expect(document.documentElement.dataset.code).toBe("graphite");

    await user.selectOptions(screen.getByLabelText("界面字体"), "inter");
    expect(document.documentElement.dataset.uiFont).toBe("inter");
    await user.selectOptions(screen.getByLabelText("正文字体"), "georgia");
    expect(document.documentElement.dataset.proseFont).toBe("georgia");
    await user.selectOptions(screen.getByLabelText("代码字体"), "consolas");
    expect(document.documentElement.dataset.codeFont).toBe("consolas");

    fireEvent.change(screen.getByLabelText("界面字号"), { target: { value: "16" } });
    expect(document.documentElement.style.getPropertyValue("--ui-zoom")).toBe(String(16 / 14));
    fireEvent.change(screen.getByLabelText("正文字号"), { target: { value: "19" } });
    expect(document.documentElement.style.getPropertyValue("--prose-size")).toBe("19px");

    expect(JSON.parse(localStorage.getItem("appearance") ?? "{}")).toMatchObject({
      theme: "dark",
      accent: "blue",
      code: "graphite",
      uiFont: "inter",
      proseFont: "georgia",
      codeFont: "consolas",
      uiSize: 16,
      proseSize: 19,
    });
    localStorage.clear();
  });

});