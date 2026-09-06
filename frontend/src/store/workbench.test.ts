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
import { draftBody, draftDocument, isDirty, useFiles } from "./files";
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

/* 批注 3.3: the prose page and the file page share one buffer, so "what the prose
   page shows" is a projection of the file entry - read it the same way here. */
const buffer = () => useFiles.getState().entries[draftDoc.path];
const draftBodyOf = () => draftBody(buffer().draft, 42);

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
      busy: false,
      error: null,
    });
    // 批注 3.3: there is one buffer, and it lives in the file store.
    useFiles.setState({
      novelId: 1,
      metas: [],
      tabs: [],
      active: null,
      entries: {
        [draftDoc.path]: {
          doc: draftDoc,
          draft: draftDocument(42, "沈曜推开了石门。"),
          loading: false,
          saving: false,
          error: null,
          conflict: false,
          savedAt: null,
        },
      },
      pending: {},
      views: {},
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
    expect(api.writeFile).toHaveBeenCalledWith(
      1,
      "chapters/0042/draft.md",
      expect.stringContaining("# 第 42 章正文"),
      { actor: "human", baseRevision: "draft-1" },
    );
    expect(api.writeFile).toHaveBeenCalledWith(
      1,
      "chapters/0042/draft.md",
      expect.stringContaining("沈曜推开了石门。"),
      { actor: "human", baseRevision: "draft-1" },
    );
    expect(useWorkbench.getState().chapters[0].content).toContain("石门");
    expect(useWorkbench.getState().error).toBeNull();
  });

  it("targets the selected chapter's brief, not a stale selected brief id", async () => {
    // what the server holds once the run has written the chapter
    vi.mocked(api.readFile).mockResolvedValue({
      ...draftDoc,
      text: draftDocument(42, "新正文。"),
      revision: "draft-2",
    });
    await useWorkbench.getState().generateDraft();

    expect(api.streamGeneration).toHaveBeenCalledWith(1, 2, expect.any(Function));
    expect(useWorkbench.getState().lastGenerationRunId).toBe(10);
    // the one buffer, not a copy of it: the run's saved text, re-read from the file
    expect(draftBodyOf()).toBe("新正文。");
    expect(useFiles.getState().entries[draftDoc.path].doc?.revision).toBe("draft-2");
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

describe("one draft buffer, read by both pages (批注 3.3)", () => {
  const a: Chapter = { ...chapter, id: 8, chapter_number: 1, content: "第一章原句。", title: "甲" };
  const b: Chapter = { ...chapter, id: 9, chapter_number: 2, content: "第二章原句。", title: "乙" };
  const pathA = "chapters/0001/draft.md";
  const pathB = "chapters/0002/draft.md";

  const entry = (text: string) => ({
    doc: { ...draftDoc, path: "", text, revision: "r1" },
    draft: text,
    loading: false,
    saving: false,
    error: null,
    conflict: false,
    savedAt: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbench.setState({
      selectedNovelId: 1,
      chapters: [a, b],
      selectedChapterId: a.id,
      chapterTabs: [a.id, b.id],
    });
    useFiles.setState({
      novelId: 1,
      metas: [],
      tabs: [],
      active: null,
      pending: {},
      views: {},
      entries: {
        [pathA]: entry(draftDocument(1, "第一章原句。")),
        [pathB]: entry(draftDocument(2, "第二章原句。")),
      },
    });
  });

  it("shows the same words in the source and on the prose page, both ways", () => {
    // Prose page -> file source.
    useWorkbench.getState().setDraftContent("第一章改到一半。");
    expect(useFiles.getState().entries[pathA].draft).toContain("第一章改到一半。");

    // File source -> prose page. This is the direction that used to be a separate
    // buffer, and whichever page saved last deleted the other's words.
    useFiles.getState().setDraft(pathA, draftDocument(1, "从源码页写的一句话。"));
    expect(draftBody(useFiles.getState().entries[pathA].draft, 1)).toBe("从源码页写的一句话。");
  });

  it("says dirty in one voice, wherever it is read from", () => {
    expect(useWorkbench.getState().isChapterDirty(a.id)).toBe(false);
    expect(isDirty(useFiles.getState().entries[pathA])).toBe(false);

    useWorkbench.getState().setDraftContent("改了还没存。");
    expect(useWorkbench.getState().isChapterDirty(a.id)).toBe(true);
    expect(isDirty(useFiles.getState().entries[pathA])).toBe(true);
  });

  it("keeps unsaved text when the reader looks at another chapter", () => {
    useWorkbench.getState().setDraftContent("第一章改到一半。");
    useWorkbench.getState().selectChapter(b.id);
    expect(draftBody(useFiles.getState().entries[pathB].draft, 2)).toBe("第二章原句。");
    expect(useWorkbench.getState().isChapterDirty(b.id)).toBe(false);

    useWorkbench.getState().selectChapter(a.id);
    expect(draftBody(useFiles.getState().entries[pathA].draft, 1)).toBe("第一章改到一半。");
    expect(useWorkbench.getState().isChapterDirty(a.id)).toBe(true);
  });

  it("round-trips the file a real server wrote, byte for byte", () => {
    const server = "# 第 1 章正文\n\n> 标题是投影结构；标题下方全部是正文内容。\n\n第一段。\n\n第二段。\n";
    expect(draftBody(server, 1)).toBe("第一段。\n\n第二段。");
    expect(draftDocument(1, draftBody(server, 1))).toBe(server);
    // a paragraph break typed at the very end must survive one edit cycle
    const typed = draftDocument(1, `${draftBody(server, 1)}\n`);
    expect(draftBody(typed, 1)).toBe("第一段。\n\n第二段。\n");
  });

  it("does not leak one book's drafts into the next", async () => {
    useWorkbench.getState().setDraftContent("没保存的稿子。");
    // selectNovel awaits briefs first, then chapters.
    vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([b]);
    await useWorkbench.getState().selectNovel(2);
    const s = useWorkbench.getState();
    expect(s.chapters.map((item) => item.id)).toEqual([b.id]);
    // chapter 1 of the next book must not read the words left in this book's buffer
    expect(useFiles.getState().entries[pathA]).toBeUndefined();
  });
});

/* 第二十八批批注 8：「新建对话」只让服务端开下一条线程，本地一样东西都不删。 */
describe("workbench new conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the next thread on the server and bumps the epoch", async () => {
    useWorkbench.setState({ selectedNovelId: 5, chatEpoch: 0 });
    vi.mocked(api.post).mockResolvedValueOnce({ conversation_id: 2 });

    await useWorkbench.getState().startChatConversation();

    expect(api.post).toHaveBeenCalledWith("/api/novels/5/chat/conversation");
    expect(useWorkbench.getState().chatEpoch).toBe(1);
  });

  it("does nothing when no book is selected", async () => {
    useWorkbench.setState({ selectedNovelId: null, chatEpoch: 3 });

    await useWorkbench.getState().startChatConversation();

    expect(api.post).not.toHaveBeenCalled();
    expect(useWorkbench.getState().chatEpoch).toBe(3);
  });
});
