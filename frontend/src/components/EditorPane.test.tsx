import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditorPane from "./EditorPane";
import type { Chapter } from "../types";
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

function seed(chapters: Chapter[], content = "") {
  useWorkbench.setState({
    chapters,
    selectedChapterId: chapters[0]?.id ?? null,
    draftContent: content,
    briefs: [],
    generationRuns: [],
    reviews: [],
    machineCheck: null,
    error: null,
    notice: null,
  });
}

describe("EditorPane", () => {
  beforeEach(() => {
    window.localStorage.removeItem("novelgen.editor-bottom");
    seed([]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(screen.getByText("左侧选择或新建一章开始写作。")).toBeTruthy();

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
    expect(document.querySelector(".editor-scroll textarea")).toBeTruthy();
  });

  it("collapses the records panel but keeps the save state on screen", () => {
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
    expect(screen.getByText("调用记录")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起调用记录" }));
    expect(screen.queryByText("调用记录")).toBeNull();
    expect(screen.getByRole("button", { name: "展开调用记录" })).toBeTruthy();
    // The status line is the one thing that must survive collapsing.
    expect(screen.getByText("与服务器一致")).toBeTruthy();
    expect(window.localStorage.getItem("novelgen.editor-bottom")).toContain("true");
  });

  it("shows the empty-state placeholder without a chapter", () => {
    seed([]);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    expect(screen.queryByLabelText("章节正文")).toBeNull();
    expect(document.querySelector(".minimap")).toBeNull();
  });
});
