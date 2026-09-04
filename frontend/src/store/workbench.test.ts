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

describe("workbench novel selection", () => {
  const novel = (id: number) => ({
    id,
    title: `书 ${id}`,
    description: "",
    target_chapters: 0,
    style_constraints: "",
    cover_image: "",
    cover_color: "",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbench.setState({
      novels: [],
      selectedNovelId: null,
      chapters: [],
      briefs: [],
      selectedChapterId: null,
      selectedBriefId: null,
      generationRuns: [],
      reviews: [],
      error: null,
    });
  });

  it("keeps the book the route asked for when init resolves later", async () => {
    // The race that made /novels/5 load novel 1's data: init() captured the store
    // before awaiting /api/novels, then wrote `captured ?? novels[0].id` afterwards,
    // so a selection made by the route in between was overwritten.
    const pending: ((value: unknown) => void)[] = [];
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === "/api/health" || path === "/api/llm/status") return Promise.resolve({ status: "ok" });
      if (path === "/api/novels") return new Promise((resolve) => { pending.push(resolve); });
      const id = Number(/\/novels\/(\d+)\//.exec(path)?.[1]);
      if (path.endsWith("/chapters")) return Promise.resolve([{ ...chapter, id, novel_id: id }]);
      return Promise.resolve([]);
    }) as never;

    const running = useWorkbench.getState().init();
    await useWorkbench.getState().selectNovel(5);
    pending.forEach((release) => release([novel(1), novel(5)]));
    await running;

    expect(useWorkbench.getState().selectedNovelId).toBe(5);
    // novel 1 was never loaded, because init must not reach past the route
    const asked = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
    expect(asked.filter((path) => path.includes("/api/novels/1/chapters"))).toHaveLength(0);
  });

  it("does not fetch records for a chapter that is not in the selected book", async () => {
    useWorkbench.setState({ selectedNovelId: 1, selectedChapterId: 99, chapters: [] });
    await useWorkbench.getState().loadChapterRecords();
    expect(api.get).not.toHaveBeenCalled();
    expect(useWorkbench.getState().generationRuns).toEqual([]);
  });

  it("clears the previous book's slices while switching, so ids cannot disagree", async () => {
    useWorkbench.setState({
      selectedNovelId: 1,
      chapters: [chapter],
      selectedChapterId: 8,
      briefs: [brief],
      selectedBriefId: 2,
    });
    // Resolve only after we looked: the point is what the store holds mid-flight.
    const releases: ((value: unknown) => void)[] = [];
    vi.mocked(api.get).mockImplementation(
      () => new Promise((resolve) => { releases.push(resolve); }),
    ) as never;

    const running = useWorkbench.getState().selectNovel(5);
    const mid = useWorkbench.getState();
    expect(mid.chapters).toEqual([]);
    expect(mid.selectedChapterId).toBeNull();
    expect(mid.briefs).toEqual([]);
    expect(mid.selectedBriefId).toBeNull();

    // both halves of the Promise.all have to settle or the switch never finishes
    releases.forEach((release, index) => release(index === 0 ? [brief] : [chapter]));
    await running;
    expect(useWorkbench.getState().selectedChapterId).toBe(8);
  });
});

describe("per-chapter draft buffers", () => {
  const a: Chapter = { ...chapter, id: 8, chapter_number: 1, content: "第一章原句。", title: "甲" };
  const b: Chapter = { ...chapter, id: 9, chapter_number: 2, content: "第二章原句。", title: "乙" };

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbench.setState({
      selectedNovelId: 1,
      chapters: [a, b],
      selectedChapterId: a.id,
      chapterDrafts: {
        [a.id]: { saved: a.content, draft: a.content },
        [b.id]: { saved: b.content, draft: b.content },
      },
      draftContent: a.content,
      draftSaved: a.content,
    });
  });

  it("keeps unsaved text when the reader looks at another chapter", () => {
    // Regression: one shared buffer was reloaded from the chapter record on every
    // selection, so clicking chapter two threw away what was typed into chapter one.
    useWorkbench.getState().setDraftContent("第一章改到一半。");
    expect(useWorkbench.getState().isChapterDirty(a.id)).toBe(true);

    useWorkbench.getState().selectChapter(b.id);
    expect(useWorkbench.getState().draftContent).toBe("第二章原句。");
    expect(useWorkbench.getState().isChapterDirty(b.id)).toBe(false);

    useWorkbench.getState().selectChapter(a.id);
    expect(useWorkbench.getState().draftContent).toBe("第一章改到一半。");
    expect(useWorkbench.getState().draftSaved).toBe("第一章原句。");
    expect(useWorkbench.getState().isChapterDirty(a.id)).toBe(true);
  });

  it("does not leak one book's drafts into the next", async () => {
    useWorkbench.getState().setDraftContent("没保存的稿子。");
    // selectNovel awaits briefs first, then chapters.
    vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([b]);
    await useWorkbench.getState().selectNovel(2);
    const s = useWorkbench.getState();
    expect(s.chapterDrafts[a.id]).toBeUndefined();
    expect(s.draftContent).toBe("第二章原句。");
    expect(s.isChapterDirty(b.id)).toBe(false);
  });
});
