import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    streamGeneration: vi.fn(),
  },
}));

import { api } from "../api";
import { useWorkbench } from "./workbench";
import type { Chapter, ChapterBrief, FileDoc, GenerationRun, MachineCheckResult } from "../types";

const chapter: Chapter = {
  id: 8,
  novel_id: 1,
  brief_id: 2,
  chapter_number: 42,
  title: "星渊碑影",
  content: "旧正文。",
  word_count: 4,
  status: "draft",
  final_decision: "",
  final_comment: "",
};

const draftDoc: FileDoc = {
  path: "chapters/0042/draft.md",
  kind: "draft",
  layer: "正文",
  label: "第 42 章正文",
  text: "# 第 42 章正文\n\n旧正文。\n",
  ai_fields: ["content"],
  revision: "draft-1",
};

const brief: ChapterBrief = {
  id: 2,
  novel_id: 1,
  arc_plan_id: null,
  chapter_number: 42,
  goal: "夺取碑文",
  events: "",
  pov: "",
  characters: [],
  conflict: "",
  hook: "",
  required_facts: [],
  status: "draft",
};

const run: GenerationRun = {
  id: 10,
  chapter_id: 8,
  task_type: "draft",
  model: "test-model",
  prompt_version: "v1",
  input_summary: "{}",
  output: "新正文。",
  token_input: 1,
  token_output: 2,
  cost_estimate: 0,
  status: "completed",
  created_at: "2026-09-03T00:00:00Z",
};

const check: MachineCheckResult = { passed: true, word_count: 4, issues: [] };

describe("workbench chapter writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbench.setState({
      selectedNovelId: 1,
      selectedChapterId: 8,
      chapters: [chapter],
      briefs: [brief],
      // Deliberately stale: generation must follow the selected chapter.
      selectedBriefId: 999,
      draftContent: "沈曜推开了石门。",
      busy: false,
      error: null,
    });
    vi.mocked(api.readFile).mockResolvedValue(draftDoc);
    vi.mocked(api.writeFile).mockResolvedValue({
      path: draftDoc.path,
      changed: ["content"],
      revision: "draft-2",
    });
    vi.mocked(api.get).mockResolvedValue({
      ...chapter,
      content: "沈曜推开了石门。",
      word_count: 8,
    });
    vi.mocked(api.streamGeneration).mockImplementation(async (_novelId, _briefId, onEvent) => {
      onEvent({ event: "delta", data: { text: "新" } });
      onEvent({
        event: "done",
        data: { chapter: { ...chapter, content: "新正文。", word_count: 4 }, generation_run: run, machine_check: check },
      });
    });
  });

  it("saves prose through the chapter draft file, not the legacy chapter route", async () => {
    await useWorkbench.getState().saveChapter();

    expect(api.put).not.toHaveBeenCalled();
    expect(api.readFile).toHaveBeenCalledWith(1, "chapters/0042/draft.md");
    expect(api.writeFile).toHaveBeenCalledWith(
      1,
      "chapters/0042/draft.md",
      expect.stringContaining("# 第 42 章正文"),
      { baseRevision: "draft-1" },
    );
    expect(api.writeFile).toHaveBeenCalledWith(
      1,
      "chapters/0042/draft.md",
      expect.stringContaining("沈曜推开了石门。"),
      { baseRevision: "draft-1" },
    );
    expect(useWorkbench.getState().chapters[0].content).toContain("石门");
    expect(useWorkbench.getState().error).toBeNull();
  });

  it("targets the selected chapter's brief, not a stale selected brief id", async () => {
    await useWorkbench.getState().generateDraft();

    expect(api.streamGeneration).toHaveBeenCalledWith(1, 2, expect.any(Function));
    expect(useWorkbench.getState().lastGenerationRunId).toBe(10);
    expect(useWorkbench.getState().draftContent).toBe("新正文。");
    expect(useWorkbench.getState().error).toBeNull();
  });
});
