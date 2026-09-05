import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["模型接入", "外观"]);
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

  /* 第十九批批注 3：外观从两个按钮变成四组「看样挑选」的卡片。这里钉的是
     「点下去有东西在换、换的东西存得下来」；卡片画得像不像界面，那要靠截图。 */
  it("switches theme, palette, code colours and prose font from the cards, and remembers", async () => {
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
      "色系",
      "代码配色",
      "正文字体",
    ]);

    await user.click(screen.getByRole("radio", { name: "深色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(screen.getByRole("radio", { name: "蓝" }));
    expect(document.documentElement.dataset.accent).toBe("blue");
    await user.click(screen.getByRole("radio", { name: "石墨" }));
    expect(document.documentElement.dataset.code).toBe("graphite");
    await user.click(screen.getByRole("radio", { name: "黑体" }));
    expect(document.documentElement.dataset.prose).toBe("sans");

    expect(JSON.parse(localStorage.getItem("appearance") ?? "{}")).toMatchObject({
      theme: "dark",
      accent: "blue",
      code: "graphite",
      prose: "sans",
    });

    // 选中写在卡本身上：aria-checked 加一枚勾，不靠「这张看起来颜色不一样」
    expect(screen.getByRole("radio", { name: "蓝" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "朱砂" }).getAttribute("aria-checked")).toBe("false");

    // 卡里是一格微缩界面（标题条 + 文字 + 主色 + 语法着色），不是一块纯色
    const card = screen.getByRole("radio", { name: "深色" });
    expect(card.querySelector(".pv-bar")).toBeTruthy();
    expect(card.querySelector(".pv-line.accent")).toBeTruthy();
    expect(card.querySelector(".pv-chip.key")).toBeTruthy();
    // 深色那张自己声明深色，所以页面此刻是浅是深，它都画得对
    expect(card.querySelector(".pref-preview")?.getAttribute("data-theme")).toBe("dark");
    localStorage.clear();
  });

});
