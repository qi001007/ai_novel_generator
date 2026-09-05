import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PreferencesPage from "./PreferencesPage";

const config = {
  provider: "openai_compatible",
  api_base_url: "https://gateway.example/v1",
  timeout: 120,
  models: { draft: "Model-A", review: "Model-A", summary: "", chat: "" },
  api_key_masked: "****9876",
  api_key_set: true,
  configured: true,
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

});
