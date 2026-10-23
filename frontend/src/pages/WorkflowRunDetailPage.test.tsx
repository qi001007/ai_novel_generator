import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkflowRunDetailPage from "./WorkflowRunDetailPage";

const novel = { id: 1, title: "测试作品" };

const detail = {
  id: 9,
  novel_id: 1,
  workflow_id: 3,
  workflow_version_id: 4,
  status: "completed",
  input: { chapter_id: 2, chapter_number: 1, workflow_purpose: "generation" },
  output: { out: {} },
  error: "",
  token_input: 60,
  token_output: 20,
  paused_node_id: "",
  started_at: "2026-10-23T10:00:00",
  ended_at: "2026-10-23T10:00:02",
  created_at: "2026-10-23T10:00:00",
  workflow: { id: 3, name: "正文", purpose: "generation" },
  version: { id: 4, version: 1, purpose: "generation" },
  chapter: { id: 2, chapter_number: 1, title: "雪夜" },
  job: { id: 55, status: "accepted" },
  reviews: [{
    id: 5,
    decision: "needs_revision",
    reviewer: "ai",
    comments: "改一处。",
    evidence: {},
    created_at: "2026-10-23T10:00:03",
  }],
  accept_operation: {
    id: 3,
    command: "generation.accept",
    actor: "human",
    created_at: "2026-10-23T10:00:02",
    target_id: 2,
    path: "chapters/0001/draft.md",
    revision: "abcdef123456",
  },
  nodes: [
    {
      id: 1, node_id: "start", node_type: "start", status: "completed",
      input: {}, output: {}, error: "", token_input: 0, token_output: 0,
      started_at: "2026-10-23T10:00:00", ended_at: "2026-10-23T10:00:00",
    },
    {
      id: 2, node_id: "context", node_type: "context", status: "completed",
      input: {},
      output: {
        token_budget: 8000,
        estimated_tokens: 10,
        missing_characters: ["阿青"],
        selected: [{
          key: "blueprint", source: "blueprint", title: "全书蓝图",
          reason: "命中当前 Workflow 的动态上下文策略", estimated_tokens: 10,
        }],
        excluded: [
          { key: "character:9", source: "character", title: "路人", reason: "未命中当前 Workflow 策略" },
          { key: "chapter:0", source: "chapter", title: "旧章", reason: "Token 预算已用完" },
        ],
      },
      error: "", token_input: 10, token_output: 0,
      started_at: "2026-10-23T10:00:00", ended_at: "2026-10-23T10:00:00",
    },
    {
      id: 3, node_id: "prompt", node_type: "prompt", status: "completed",
      input: {}, output: { text: "请写雪夜。" }, error: "", token_input: 0, token_output: 0,
      started_at: "2026-10-23T10:00:00", ended_at: "2026-10-23T10:00:00",
    },
    {
      id: 4, node_id: "model", node_type: "model", status: "completed",
      input: {},
      output: { text: "雪落在铜铃上。", model: "test-model", token_input: 37, token_output: 12 },
      error: "", token_input: 37, token_output: 12,
      started_at: "2026-10-23T10:00:00", ended_at: "2026-10-23T10:00:01",
    },
    {
      id: 5, node_id: "model_b", node_type: "model", status: "completed",
      input: {},
      output: { text: "第二次。", model: "test-model", token_input: 23, token_output: 8 },
      error: "", token_input: 23, token_output: 8,
      started_at: "2026-10-23T10:00:01", ended_at: "2026-10-23T10:00:02",
    },
    {
      id: 6, node_id: "output", node_type: "output", status: "completed",
      input: {},
      output: {
        issues: [{
          category: "连贯", severity: "low", location: "第 1 段",
          quote: "雪落在铜铃上。", suggestion: "雪落在铜铃上，铃声很轻。", reason: "补足声音。",
        }],
        setting_updates: [],
      },
      error: "", token_input: 0, token_output: 0,
      started_at: "2026-10-23T10:00:02", ended_at: "2026-10-23T10:00:02",
    },
  ],
};

function stubFetch(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = input.toString();
    const response = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (url.endsWith("/api/novels")) return response([novel]);
    if (url.includes("/api/workflow-runs/9")) return response(payload);
    return Promise.reject(new Error(`unexpected url: ${url}`));
  }));
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/novels/1/chapters/2/workflow-runs/9"]}>
      <Routes>
        <Route
          path="/novels/:novelId/chapters/:chapterId/workflow-runs/:runId"
          element={<WorkflowRunDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("WorkflowRunDetailPage", () => {
  it("unifies nodes, context exclusions, token totals and the accept operation", async () => {
    stubFetch(detail);
    renderPage();

    expect(await screen.findByRole("heading", { name: "第 1 章 雪夜" })).toBeTruthy();
    expect(screen.getByText(/正文 v1 · 正文生成 · 运行 #9/)).toBeTruthy();
    // Each model node reports its own tokens, and the run total is their sum.
    expect(screen.getByText("模型节点合计 = 运行总计")).toBeTruthy();
    expect(screen.getByText("37")).toBeTruthy();
    expect(screen.getByText("12", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy();
    expect(screen.getByText("8", { selector: "strong" })).toBeTruthy();

    // The context node is open on entry: selected, excluded reasons and the missing name.
    expect(screen.getByText("未命中人物：")).toBeTruthy();
    expect(screen.getByText(/阿青/)).toBeTruthy();
    expect(screen.getByText("全书蓝图")).toBeTruthy();
    expect(screen.getByText(/路人/)).toBeTruthy();
    expect(screen.getByText(/未命中当前 Workflow 策略/)).toBeTruthy();
    expect(screen.getByText(/Token 预算已用完/)).toBeTruthy();

    // Model output and the output node's structured issue both render.
    expect(screen.getAllByText(/雪落在铜铃上。/).length).toBeGreaterThan(0);
    expect(screen.getByText(/补足声音。/)).toBeTruthy();

    // Linked evidence: job, review, and the single protected write.
    expect(screen.getByText("#55 · accepted")).toBeTruthy();
    expect(screen.getByText(/chapters\/0001\/draft\.md · rev abcdef12/)).toBeTruthy();
    expect(screen.getByText("AI · needs_revision")).toBeTruthy();
  });

  it("refuses a run that belongs to another chapter", async () => {
    stubFetch({ ...detail, chapter: { id: 99, chapter_number: 9, title: "别章" } });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("运行详情不可用")).toBeTruthy();
    });
    expect(screen.getByText("这次运行不属于当前章节")).toBeTruthy();
  });
});
