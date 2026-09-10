/* 批注 30.7 第一条（＝ WORKSTREAM-PLAN §3 P0-2 第三条判据里「未命中人物」那一半）。
   简报点名而人物库没有同名卡的名字变不成任何一行注入，所以今天它们唯一的去处就是
   静默消失。这两条用例钉的是：清单里有这一项时作者看得见，旧 run 里没这一项时
   界面上不多出一行空话。 */
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { useFiles } from "../store/files";

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const chapter = {
  id: 70,
  novel_id: 1,
  chapter_number: 25,
  title: "第 25 章",
  status: "draft",
  word_count: 12,
  brief_id: 9,
  content: "石门在身后合拢。",
};

function manifestWith(missing?: string[]) {
  const manifest: Record<string, unknown> = {
    budget: 12000,
    used: 492,
    blocks: [
      {
        kind: "brief",
        label: "简报 · 第 25 章",
        ref: "brief:9",
        tier: "必注入",
        chars: 12,
        excerpt: "夺取碑文",
        injected: true,
        index: 1,
      },
      {
        kind: "character",
        label: "人物 · 林渊",
        ref: "character:1",
        tier: "必注入",
        chars: 9,
        excerpt: "重伤未愈",
        injected: true,
        index: 2,
      },
    ],
  };
  if (missing) manifest.missing_characters = missing;
  return JSON.stringify(manifest);
}

function stubServer(inputSummary: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/health")) return json({ status: "ok" });
      if (url.endsWith("/api/novels"))
        return json([{ id: 1, title: "星渊纪元", description: "", target_chapters: 120, style_constraints: "", cover_image: "" }]);
      if (url.includes("/llm/status"))
        return json({ provider: "openai_compatible", configured: false, models: {}, available_models: [] });
      if (url.endsWith("/api/novels/1/chapters")) return json([chapter]);
      if (url.endsWith("/api/novels/1/chapters/70/generation-runs"))
        return json([
          {
            id: 9,
            chapter_id: 70,
            task_type: "draft",
            model: "MiniMax-M2.5",
            prompt_version: "v1",
            input_summary: inputSummary,
            output: "石门在身后合拢。",
            token_input: 492,
            token_output: 12,
            cost_estimate: 0,
            status: "success",
            created_at: "2026-09-11T04:00:00+08:00",
          },
        ]);
      if (url.endsWith("/api/novels/1/planning/briefs"))
        return json([{ id: 9, novel_id: 1, chapter_number: 25, goal: "夺取碑文", characters: ["林渊", "白衣人"] }]);
      if (url.endsWith("/api/novels/1/chapters/70/reviews")) return json([]);
      if (url.endsWith("/api/novels/1/chapters/70/machine-check"))
        return json({ passed: true, word_count: 12, issues: [] });
      return json([]);
    }),
  );
}

async function openRunDetail() {
  render(
    <MemoryRouter initialEntries={["/novels/1/chapters/70/runs/9"]}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelector(".manifest-row")).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear();
  useFiles.getState().reset();
  vi.unstubAllGlobals();
});

describe("GenerationRunDetailPage 的未命中人物（批注 30.7 第一条）", () => {
  it("清单里有未命中的人物时，注入上下文那一栏把名字说出来", async () => {
    stubServer(manifestWith(["白衣人"]));
    await openRunDetail();
    const notice = document.querySelector(".manifest-missing");
    expect(notice?.textContent).toContain("未命中人物：白衣人");
    expect(notice?.textContent).toContain("简报点名，人物库无同名卡");
    // 说在表头之前：这一句讲的是「下面没有他的行」，不该排到数据后面去
    const columns = document.querySelector(".manifest-columns");
    expect(notice && columns && notice.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 只多这一句，不多一行数据
    expect(document.querySelectorAll(".manifest-row").length).toBe(2);
  });

  it("全命中（这一项是空数组）时不出这一行", async () => {
    stubServer(manifestWith([]));
    await openRunDetail();
    expect(document.querySelector(".manifest-missing")).toBeNull();
    expect(document.body.textContent).not.toContain("未命中人物");
  });

  it("旧 run 的清单里没有这一项时，界面上不多出一行空话", async () => {
    stubServer(manifestWith());
    await openRunDetail();
    expect(document.querySelector(".manifest-missing")).toBeNull();
    expect(document.body.textContent).not.toContain("未命中人物");
    expect(document.querySelectorAll(".manifest-row").length).toBe(2);
  });
});
