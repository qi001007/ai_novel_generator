import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditorPane from "./EditorPane";
import { api } from "../api";
import { draftDocument, useFiles } from "../store/files";
import type { Chapter, WorkflowRunSummary } from "../types";
import { useWorkbench } from "../store/workbench";

const emptyChapter = {
  id: 1,
  novel_id: 1,
  brief_id: null,
  chapter_number: 1,
  title: "破镜",
  content: "第一段正文。\n\n\t第二段带缩进。\n\n\n结尾一句。",
  word_count: 20,
  status: "draft",
  final_decision: "",
  final_comment: "",
};
let canvasGetContext: PropertyDescriptor | null | undefined = null;

function workflowRun(
  overrides: Partial<WorkflowRunSummary> & { chapter_id?: number } = {},
): WorkflowRunSummary {
  const { chapter_id = 1, ...rest } = overrides;
  return {
    id: 1,
    novel_id: 1,
    workflow_id: 1,
    workflow_version_id: 1,
    status: "completed",
    input: { chapter_id },
    error: "",
    token_input: 0,
    token_output: 0,
    paused_node_id: "",
    started_at: null,
    ended_at: null,
    created_at: "2026-10-23T10:00:00",
    workflow_name: "Workflow",
    workflow_version: 1,
    purpose: "generation",
    node_count: 5,
    model: "test-model",
    job: null,
    review: null,
    accept_operation: null,
    ...rest,
  };
}

function seed(chapters: Chapter[], content = "") {
  useWorkbench.setState({
    selectedNovelId: 1,
    chapters,
    selectedChapterId: chapters[0]?.id ?? null,
    chapterTabs: chapters.map((item) => item.id),
    briefs: [],
    generationRuns: [],
    workflowRuns: [],
    generationCandidates: [],
    reviews: [],
    machineCheck: null,
    error: null,
    notice: null,
  });
  // 批注 3.3: the prose page has no buffer of its own - it reads the draft.md entry,
  // so that is what a test has to fill.
  const first = chapters[0];
  const text = draftDocument(first?.chapter_number ?? 1, content);
  useFiles.setState({
    novelId: 1,
    metas: [],
    tabs: [],
    active: null,
    pending: {},
    // the toggle map has to start empty, or a previous test's stage leaks into this one
    stage: null,
    views: {},
    entries: first
      ? {
          [`chapters/${String(first.chapter_number).padStart(4, "0")}/draft.md`]: {
            doc: {
              path: "",
              kind: "draft",
              layer: "正文",
              label: "",
              text: draftDocument(first.chapter_number, first.content),
              ai_fields: ["content"],
              revision: "r1",
            },
            draft: text,
            loading: false,
            saving: false,
            error: null,
            conflict: false,
            savedAt: null,
          },
        }
      : {},
  });
}

describe("EditorPane", () => {
  it("B-02 shows a recoverable candidate without replacing prose and closes preview without accepting", async () => {
    seed([emptyChapter], emptyChapter.content);
    useWorkbench.setState({ generationCandidates: [{
      id: 23, novel_id: 1, kind: "draft", status: "completed", error: "",
      payload: { chapter_id: 1, path: "chapters/0001/draft.md", base_revision: "r1", request: "" },
      result: { content: "候选另存的正文。", workflow_run_id: 7, token_input: 24, token_output: 9 },
    }] });
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "查看候选（1）" }));
    expect(screen.getByRole("dialog", { name: "候选正文" })).toBeTruthy();
    expect(screen.getByText("候选另存的正文。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "稍后处理" }));
    expect(screen.queryByRole("dialog", { name: "候选正文" })).toBeNull();
    expect(useWorkbench.getState().generationCandidates[0].status).toBe("completed");
    expect(useWorkbench.getState().chapters[0].content).toBe(emptyChapter.content);
  });

  beforeEach(() => {
    window.localStorage.removeItem("novelgen.editor-bottom");
    seed([]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (canvasGetContext) {
      Object.defineProperty(
        window.HTMLCanvasElement.prototype,
        "getContext",
        canvasGetContext,
      );
      canvasGetContext = null;
    }
  });

  it("keeps hook order when a chapter arrives after the empty state", () => {
    const { rerender } = render(<MemoryRouter><EditorPane /></MemoryRouter>);
    expect(screen.getByText("左侧选择或新建一章开始写作")).toBeTruthy();

    act(() => seed([emptyChapter], emptyChapter.content));
    rerender(<MemoryRouter><EditorPane /></MemoryRouter>);

    expect(screen.getByLabelText("章节正文")).toBeTruthy();
  });

  it("renders the minimap as one scaled row per content line", () => {
    const drawn: string[] = [];
    canvasGetContext = Object.getOwnPropertyDescriptor(
      window.HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
      value() {
        return {
          setTransform: () => undefined,
          clearRect: () => undefined,
          fillRect: () => undefined,
          fillText: (text: string) => drawn.push(text),
        };
      },
      configurable: true,
    });
    seed([emptyChapter], emptyChapter.content);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);

    // Five lines, two of them blank, so three rows carry text.
    expect(document.querySelector(".minimap-canvas")).toBeTruthy();
    expect(drawn).toEqual(["第一段正文。", "第二段带缩进。", "结尾一句。"]);
  });

  it("drives the slider from the scroll ratio, not from JS-measured pixels", () => {
    seed([emptyChapter], emptyChapter.content);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);

    // The textarea is the scroller and the slider follows it through CSS vars:
    // a cached pixel height once went stale and collapsed the map to 1px.
    const map = document.querySelector(".minimap") as HTMLElement;
    expect(map.style.getPropertyValue("--view-top")).not.toBe("");
    expect(map.style.getPropertyValue("--view-height")).not.toBe("");
    expect(document.querySelector(".editor-cm .cm-content")).toBeTruthy();
  });

  it("keeps the records panel folded until the icon asks for it", () => {
    seed([emptyChapter], emptyChapter.content);
    useWorkbench.setState({
      generationRuns: [{
        id: 7,
        chapter_id: 1,
        task_type: "draft",
        model: "MiniMax-M2.5",
        prompt_version: "v1",
        input_summary: "",
        output: "",
        token_input: 10,
        token_output: 20,
        cost_estimate: 0,
        status: "done",
        created_at: "2026-09-03T03:16:58",
      }],
    });
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    // 批注 17: token accounting was open on every entry, so it was the first
    // thing a writer saw. 批注 18: its door is an icon now, not a bar.
    expect(screen.queryByText("调用记录")).toBeNull();
    expect(document.querySelector(".record-list")).toBeNull();
    const toggle = screen.getByRole("button", { name: "展开调用记录" });
    expect(toggle.querySelector("svg")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByText("调用记录")).toBeTruthy();
    expect(document.querySelector(".record-list")).toBeTruthy();

    // One door, not two: the same icon closes it again.
    fireEvent.click(screen.getByRole("button", { name: "收起调用记录" }));
    expect(document.querySelector(".record-list")).toBeNull();
    // Save state and the count moved onto the action line, so folding the panel
    // no longer takes them with it.
    expect(document.querySelector(".editor-status")?.textContent).toContain("字");
    expect(window.localStorage.getItem("novelgen.editor-bottom")).toContain("true");
  });

  it("opens an empty records panel immediately, before records finish loading", () => {
    seed([emptyChapter], emptyChapter.content);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "展开调用记录" }));

    expect(screen.getByText("调用记录")).toBeTruthy();
    expect(screen.getByRole("list", { name: "生成与审稿记录" })).toBeTruthy();
    expect(screen.getByText("这一章还没有调用记录")).toBeTruthy();
  });

  it("shows only records belonging to the selected chapter", () => {
    const otherChapter = { ...emptyChapter, id: 2, chapter_number: 2, title: "另一章" };
    seed([emptyChapter, otherChapter], emptyChapter.content);
    useWorkbench.setState({
      generationRuns: [
        { id: 7, chapter_id: 1, task_type: "draft", model: "当前章模型", prompt_version: "v1", input_summary: "", output: "", token_input: 10, token_output: 20, cost_estimate: 0, status: "done", created_at: "2026-09-03T03:16:58" },
        { id: 8, chapter_id: 2, task_type: "draft", model: "其他章模型", prompt_version: "v1", input_summary: "", output: "", token_input: 10, token_output: 20, cost_estimate: 0, status: "done", created_at: "2026-09-03T03:16:59" },
      ],
      workflowRuns: [
        workflowRun({ id: 11, chapter_id: 1, purpose: "generation", workflow_name: "当前章 Workflow" }),
        workflowRun({ id: 12, chapter_id: 2, purpose: "review", workflow_name: "其他章 Workflow" }),
      ],
    });
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "展开调用记录" }));

    expect(screen.getByText("当前章模型")).toBeTruthy();
    expect(screen.getByText("当前章 Workflow")).toBeTruthy();
    expect(screen.queryByText("其他章模型")).toBeNull();
    expect(screen.queryByText("其他章 Workflow")).toBeNull();
  });

  it("shows the human rejection reason in the records after a refresh", () => {
    seed([emptyChapter], emptyChapter.content);
    useWorkbench.setState({
      reviews: [{
        id: 9,
        chapter_id: 1,
        reviewer: "human",
        decision: "reject",
        comments: "第二段动机不成立",
        scores: {},
        evidence: {},
        created_at: "2026-10-23T10:00:00",
      }],
    });
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "展开调用记录" }));

    expect(screen.getByText("终审打回")).toBeTruthy();
    expect(screen.getByText("第二段动机不成立")).toBeTruthy();
    expect(screen.queryByText("这一章还没有调用记录")).toBeNull();
  });

  it("links a workflow run row to the unified run detail", () => {
    seed([emptyChapter], emptyChapter.content);
    useWorkbench.setState({
      workflowRuns: [
        workflowRun({
          id: 77, chapter_id: 1, purpose: "generation", workflow_name: "正文",
          model: "test-model", token_input: 37, token_output: 12,
        }),
      ],
    });
    render(
      <MemoryRouter initialEntries={["/novels/1"]}>
        <Routes>
          <Route path="/novels/1" element={<EditorPane />} />
          <Route
            path="/novels/1/chapters/1/workflow-runs/77"
            element={<div>统一运行详情</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "展开调用记录" }));

    expect(screen.getByText("正文", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/正文生成/)).toBeTruthy();
    expect(screen.getByText(/37 \/ 12 token/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText("统一运行详情")).toBeTruthy();
  });

  it("marks a live AI suggestion in the real prose CodeMirror and only applies an intact anchor", async () => {
    const content = "雨落在旧桥上，沈曜没有回头。";
    seed([{ ...emptyChapter, content }], content);
    const review = {
        id: 19,
        chapter_id: 1,
        reviewer: "ai",
        decision: "needs_revision",
        comments: "可再收束语气。",
        scores: {},
        evidence: {
          suggestions: [{
            quote: "沈曜没有回头。",
            replacement: "沈曜仍没有回头。",
            comment: "强化人物克制。",
            anchor: { before: "雨落在旧桥上，", after: "", occurrence: 0 },
          }],
        },
        created_at: "2026-09-16T09:00:00",
      };
    vi.spyOn(api, "patch").mockResolvedValue({
      ...review,
      evidence: {
        ...review.evidence,
        suggestions: [{
          ...(review.evidence.suggestions as object[])[0],
          status: "applied",
        }],
      },
    });
    useWorkbench.setState({
      reviews: [review],
    });
    render(<MemoryRouter><EditorPane /></MemoryRouter>);

    await waitFor(() => expect(document.querySelector(".editor-cm .cm-editor")).toBeTruthy());
    const mark = document.querySelector(".cm-review-mark") as HTMLElement;
    expect(mark?.textContent).toBe("沈曜没有回头。");
    fireEvent.mouseDown(mark);
    expect(screen.getByRole("dialog", { name: "AI 审稿建议" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "应用这条建议" }));
    expect(useFiles.getState().entries["chapters/0001/draft.md"]?.draft).toContain("沈曜仍没有回头。");
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      "/api/novels/1/chapters/1/reviews/19/suggestions/0",
      { replacement: "沈曜仍没有回头。", status: "applied" },
    ));
    // One decision ends the panel; it must not sit there looking unanswered.
    expect(screen.queryByRole("dialog", { name: "AI 审稿建议" })).toBeNull();
  });

  /* 第十五批批注 1.4: the pair-toggle used to exist only on the file strip, so the
     chapter strip had no button at all and the prose page was a dead end. */
  it("offers the same render/source toggle the file strip has", () => {
    seed([emptyChapter], emptyChapter.content);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);

    const button = document.querySelector(".editor-tabs .editor-tabs-actions button");
    expect(button).toBeTruthy();
    // the prose page IS the rendered view, so the button offers the source
    expect(button?.getAttribute("aria-label")).toBe("切到源码视图");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(button?.querySelector("svg")).toBeTruthy();

    // one press -> the source side; the file column comes forward through revealSeq
    const revealed = useFiles.getState().revealSeq;
    fireEvent.click(button!);
    expect(useFiles.getState().views["chapters/0001/draft.md"]).toBe(true);
    expect(useFiles.getState().revealSeq).toBeGreaterThan(revealed);
    expect(button?.getAttribute("aria-label")).toBe("切到正文页");
    expect(button?.getAttribute("aria-pressed")).toBe("true");

    // and back: the prose page is asked for by name, on the same single boolean
    fireEvent.click(button!);
    expect(useFiles.getState().views["chapters/0001/draft.md"]).toBe(false);
    expect(useFiles.getState().stage?.path).toBe("chapters/0001/draft.md");
    expect(button?.getAttribute("aria-label")).toBe("切到源码视图");
  });

  it("shows the empty-state placeholder without a chapter", () => {
    seed([]);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    expect(screen.queryByLabelText("章节正文")).toBeNull();
    expect(document.querySelector(".minimap")).toBeNull();
  });
});
