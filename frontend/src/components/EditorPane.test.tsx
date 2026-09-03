import { act, render, screen } from "@testing-library/react";
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

  it("draws one minimap bar per non-blank line", () => {
    const fillCalls: Array<{ x: number }> = [];
    canvasGetContext = Object.getOwnPropertyDescriptor(
      window.HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
      value() {
        return {
          setTransform: () => undefined,
          clearRect: () => undefined,
          fillRect: (x: number) => fillCalls.push({ x }),
        };
      },
      configurable: true,
    });
    seed([emptyChapter], emptyChapter.content);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);

    // Five lines, two of them blank, so three bars carry content.
    expect(document.querySelector(".minimap-canvas")).toBeTruthy();
    expect(document.querySelector(".minimap-viewport")).toBeTruthy();
    expect(fillCalls).toHaveLength(3);
  });

  it("shows the empty-state placeholder without a chapter", () => {
    seed([]);
    render(<MemoryRouter><EditorPane /></MemoryRouter>);
    expect(screen.queryByLabelText("章节正文")).toBeNull();
    expect(document.querySelector(".minimap")).toBeNull();
  });
});
