import { create } from "zustand";

import { api } from "../api";
import { briefPath, draftBody, draftDocument, draftPath, useFiles } from "../store/files";
import type {
  Chapter,
  ChapterBrief,
  GenerationRun,
  LLMStatus,
  MachineCheckResult,
  Novel,
  NovelUpdatePayload,
  Review,
} from "../types";

/** The one buffer a chapter's prose lives in: the draft.md file entry. Both the
 * prose page and the file editor read it, so they cannot overwrite each other. */
export const chapterDraftPath = (chapter: Chapter) => draftPath(chapter.chapter_number);

const dirtyOf = (chapter: Chapter): boolean => {
  const entry = useFiles.getState().entries[chapterDraftPath(chapter)];
  if (!entry?.doc) return false;
  return draftBody(entry.draft, chapter.chapter_number) !== draftBody(entry.doc.text, chapter.chapter_number);
};

/** Open the draft.md buffer for a chapter the prose page is about to show. */
function hydrateChapterDraft(chapter: Chapter) {
  const path = chapterDraftPath(chapter);
  // The prose page is the rendered side of the pair, so it stamps the same map the
  // toggle reads - otherwise a chapter opened from the tree keeps showing the old
  // label from an earlier visit to its file page (第十五批批注 1.4).
  useFiles.setState((state) => ({ views: { ...state.views, [path]: false } }));
  // Seed from the chapter record so the page is never blank while the file read
  // is in flight; ensure() then replaces it with the server text unless someone
  // typed in the meantime.
  useFiles.getState().seedDraft(path, draftDocument(chapter.chapter_number, chapter.content ?? ""));
  void useFiles.getState().ensure(path);
}

export type HealthState = "loading" | "ok" | "error";
export type WorkspaceTab = "write" | "plan" | "feedback";
export type ThemeState = "light" | "dark";

type WorkbenchState = {
  tab: WorkspaceTab;
  health: HealthState;
  llmStatus: LLMStatus | null;
  novels: Novel[];
  selectedNovelId: number | null;
  briefs: ChapterBrief[];
  selectedBriefId: number | null;
  chapters: Chapter[];
  selectedChapterId: number | null;
  /** Chapters opened in the editor strip, in the order they were opened. */
  chapterTabs: number[];
  machineCheck: MachineCheckResult | null;
  generationRuns: GenerationRun[];
  reviews: Review[];
  lastGenerationRunId: number | null;
  recordVersion: number;
  error: string | null;
  notice: string | null;
  busy: boolean;
  creatingChapter: boolean;
  createError: string | null;
  theme: ThemeState;
  init: () => Promise<void>;
  toggleTheme: () => void;
  createNovel: (payload: { title: string; description: string; target_chapters: number; style_constraints: string }) => Promise<Novel>;
  updateNovel: (novelId: number, payload: NovelUpdatePayload) => Promise<Novel>;
  setTab: (tab: WorkspaceTab) => void;
  selectNovel: (novelId: number) => Promise<void>;
  selectBrief: (briefId: number) => void;
  selectChapter: (chapterId: number) => void;
  /** The prose of the selected chapter, read out of the draft.md buffer. */
  setDraftContent: (content: string) => void;
  isChapterDirty: (chapterId: number) => boolean;
  openChapterTab: (chapterId: number) => void;
  closeChapterTab: (chapterId: number) => void;
  generateDraft: () => Promise<void>;
  saveChapter: () => Promise<void>;
  runMachineCheck: () => Promise<void>;
  reviewChapter: (decision: "accept" | "reject") => Promise<void>;
  runAiReview: () => Promise<void>;
  extractChapterFacts: () => Promise<void>;
  loadChapterRecords: () => Promise<void>;
  createNextChapter: () => Promise<number | null>;
};

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  tab: "write",
  health: "loading",
  llmStatus: null,
  novels: [],
  selectedNovelId: null,
  briefs: [],
  selectedBriefId: null,
  chapters: [],
  selectedChapterId: null,
  chapterTabs: [],
  machineCheck: null,
  generationRuns: [],
  reviews: [],
  lastGenerationRunId: null,
  recordVersion: 0,
  error: null,
  notice: null,
  busy: false,
  creatingChapter: false,
  createError: null,
  theme: ((): ThemeState => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  })(),

  toggleTheme() {
    const theme: ThemeState = get().theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    set({ theme });
  },

  async createNovel(payload) {
    const novel = await api.post<Novel>("/api/novels", payload);
    set({ novels: [...get().novels, novel] });
    return novel;
  },

  async init() {
    document.documentElement.dataset.theme = get().theme;
    try {
      await api.get<{ status: string }>("/api/health");
    } catch {
      set({ health: "error" });
    }
    api.get<LLMStatus>("/api/llm/status").then((data) => {
      set({ llmStatus: data });
    }).catch(() => set({ llmStatus: null }));
    try {
      const novels = await api.get<Novel[]>("/api/novels");
      // Re-read the store: `state` was captured before the awaits above, and a route
      // that already picked a book during that gap must not be overwritten by the
      // first novel in the list. That clobber made /novels/5 briefly load novel 1.
      const now = get();
      const selected = now.selectedNovelId ?? novels[0]?.id ?? null;
      set({ novels, health: "ok", selectedNovelId: selected });
      if (selected !== null && selected !== now.selectedNovelId) {
        await get().selectNovel(selected);
      }
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "加载失败" });
    }
  },

  setTab(tab) {
    set({ tab });
  },

  async updateNovel(novelId, payload) {
    const updated = await api.put<Novel>(`/api/novels/${novelId}`, payload);
    set({ novels: get().novels.map((item) => (item.id === novelId ? updated : item)) });
    return updated;
  },

  async selectNovel(novelId) {
    // Drop the previous book's slices before the fetch: while it is in flight the
    // store would otherwise hold a new novel id next to old chapters, and anything
    // that builds a URL from both would name a pair that never existed.
    // Drafts belong to a book. Carrying them across a switch would show one
    // novel's text in another novel's tab, keyed by a chapter id that may exist
    // in both.
    set({
      chapters: [],
      briefs: [],
      selectedChapterId: null,
      selectedBriefId: null,
      generationRuns: [],
      reviews: [],
      chapterTabs: [],
    });
    // The draft buffers live in the file store now, and a path like
    // chapters/0001/draft.md is the same string in every book - so the previous
    // book's unsaved words would read as this book's chapter one. attach() clears
    // them a moment later anyway; doing it here closes the window.
    useFiles.getState().reset();
    try {
      const [briefs, chapters] = await Promise.all([
        api.get<ChapterBrief[]>(`/api/novels/${novelId}/planning/briefs`),
        api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
      ]);
      const first = chapters[0] ?? null;
      set({
        selectedNovelId: novelId,
        briefs,
        selectedBriefId: briefs[0]?.id ?? null,
        chapters,
        selectedChapterId: first?.id ?? null,
        chapterTabs: first ? [first.id] : [],
      });
      // The first chapter is chosen by assignment during load, so it never passes
      // through selectChapter - its buffer has to be seeded here or the editor
      // opens onto an empty page.
      if (first) hydrateChapterDraft(first);
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "加载失败" });
    }
  },

  // One append at the end of D: the Chapter row and its brief must appear
  // together, so a half-created chapter is reported rather than hidden.
  async createNextChapter() {
    const { selectedNovelId, chapters, briefs, creatingChapter } = get();
    if (selectedNovelId === null || creatingChapter) return null;
    const known = [
      ...chapters.map((item) => item.chapter_number),
      ...briefs.map((item) => item.chapter_number),
    ];
    const next = (known.length ? Math.max(...known) : 0) + 1;
    set({ creatingChapter: true, createError: null });
    try {
      const blank = await api.readFile(selectedNovelId, briefPath(next));
      await api.writeFile(selectedNovelId, blank.path, blank.text, {
        baseRevision: blank.revision,
      });
      const [freshBriefs, freshChapters] = await Promise.all([
        api.get<ChapterBrief[]>(`/api/novels/${selectedNovelId}/planning/briefs`),
        api.get<Chapter[]>(`/api/novels/${selectedNovelId}/chapters`),
      ]);
      const made = freshChapters.find((item) => item.chapter_number === next);
      set({
        briefs: freshBriefs,
        chapters: freshChapters,
        selectedBriefId: freshBriefs.find((item) => item.chapter_number === next)?.id ?? null,
        selectedChapterId: made?.id ?? get().selectedChapterId,
        creatingChapter: false,
        createError: null,
      });
      return next;
    } catch (cause) {
      set({
        creatingChapter: false,
        createError: String(cause instanceof Error ? cause.message : "新建章节失败"),
      });
      return null;
    }
  },

  selectBrief(briefId) {
    set({ selectedBriefId: briefId });
  },

  // Nothing to write back on leaving a chapter: the text lives in the file
  // buffer keyed by path, so switching chapters cannot discard it.
  selectChapter(chapterId) {
    if (get().selectedChapterId === chapterId) return;
    set({ selectedChapterId: chapterId });
    const chapter = get().chapters.find((item) => item.id === chapterId);
    if (chapter) hydrateChapterDraft(chapter);
  },

  setDraftContent(content) {
    const { selectedChapterId, chapters } = get();
    const chapter = chapters.find((item) => item.id === selectedChapterId);
    if (!chapter) return;
    useFiles.getState().setDraft(chapterDraftPath(chapter), draftDocument(chapter.chapter_number, content));
  },

  isChapterDirty(chapterId) {
    const chapter = get().chapters.find((item) => item.id === chapterId);
    return chapter ? dirtyOf(chapter) : false;
  },

  openChapterTab(chapterId) {
    const { chapterTabs } = get();
    if (!chapterTabs.includes(chapterId)) {
      set({ chapterTabs: [...chapterTabs, chapterId] });
    }
    get().selectChapter(chapterId);
    // selectChapter ignores a chapter that is already the selection, and that is
    // exactly the case where the buffer was never asked for.
    const chapter = get().chapters.find((item) => item.id === chapterId);
    if (chapter) hydrateChapterDraft(chapter);
  },

  closeChapterTab(chapterId) {
    const { chapterTabs, selectedChapterId } = get();
    const at = chapterTabs.indexOf(chapterId);
    if (at < 0) return;
    const rest = chapterTabs.filter((id) => id !== chapterId);
    // The buffer stays: closing a tab is not undoing a draft, and reopening the
    // chapter should give the text back.
    set({ chapterTabs: rest });
    if (selectedChapterId !== chapterId) return;
    const next = rest[Math.min(at, rest.length - 1)];
    if (next === undefined) {
      set({ selectedChapterId: null });
      return;
    }
    get().selectChapter(next);
  },

  async generateDraft() {
    const { selectedNovelId, selectedChapterId, selectedBriefId, briefs, chapters, busy } = get();
    if (!selectedNovelId || busy) return;
    const chapter = chapters.find((item) => item.id === selectedChapterId) ?? null;
    const brief =
      (chapter
        ? briefs.find((item) => item.id === chapter.brief_id) ??
          briefs.find((item) => item.chapter_number === chapter.chapter_number)
        : null) ??
      briefs.find((item) => item.id === selectedBriefId) ??
      null;
    if (!chapter || !brief) {
      set({ error: "请先选择章节；该章还需要一份 D 层简报" });
      return;
    }

    set({ busy: true, error: null });
    try {
      let streamed = "";
      await api.streamGeneration(
        selectedNovelId,
        brief.id,
        (event) => {
          if (event.event === "delta") {
            streamed += event.data.text;
            // One write, into the buffer the file editor reads too (批注 3.3).
            useFiles.getState().setDraft(
              chapterDraftPath(chapter),
              draftDocument(chapter.chapter_number, streamed),
            );
            return;
          }
          if (event.event === "done") {
            const result = {
              chapter: event.data.chapter,
              generation_run: event.data.generation_run,
              machine_check: event.data.machine_check,
            };
            set({
              chapters: get().chapters.some((item) => item.id === result.chapter.id)
                ? get().chapters.map((item) => (item.id === result.chapter.id ? result.chapter : item))
                : [...get().chapters, result.chapter],
              selectedChapterId: result.chapter.id,
              selectedBriefId: result.chapter.brief_id ?? get().selectedBriefId,
              machineCheck: result.machine_check,
              lastGenerationRunId: result.generation_run.id,
              recordVersion: get().recordVersion + 1,
              error: null,
            });
            void useFiles.getState().refreshMetas();
          }
          if (event.event === "error") {
            throw new Error(event.data.message || "生成失败");
          }
        },
      );
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "生成失败" });
    } finally {
      set({ busy: false });
    }
    // The run wrote the file server-side, so the baseline this buffer was read
    // against is gone: re-read here, where it can be awaited, and the prose page
    // and the file page both pick up the same saved text.
    if (chapter) await useFiles.getState().reload(chapterDraftPath(chapter));
  },

  /* The prose page and the file page share one buffer, so saving is the file
     layer's own save: same PUT, same base revision, same conflict flag. What this
     adds is the chapter record, which only the server can recompute. */
  async saveChapter() {
    const { selectedChapterId, busy } = get();
    const chapter = get().chapters.find((item) => item.id === selectedChapterId);
    if (chapter === null || chapter === undefined || busy) return;
    const path = chapterDraftPath(chapter);

    set({ busy: true, error: null });
    const saved = await useFiles.getState().save(path);
    if (!saved) {
      set({
        busy: false,
        error: useFiles.getState().entries[path]?.error ?? "保存失败",
      });
      return;
    }
    try {
      const updated = await api.get<Chapter>(
        `/api/novels/${get().selectedNovelId}/chapters/${chapter.id}`,
      );
      set({ chapters: get().chapters.map((item) => (item.id === updated.id ? updated : item)) });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "章节记录刷新失败" });
    } finally {
      set({ busy: false });
    }
  },

  async runMachineCheck() {
    const { selectedNovelId, selectedChapterId, briefs, busy } = get();
    const chapter = get().chapters.find((item) => item.id === selectedChapterId);
    if (!selectedNovelId || !chapter || busy) return;

    set({ busy: true, error: null });
    try {
      const brief = briefs.find((item) => item.id === chapter.brief_id);
      const result = await api.post<MachineCheckResult>(
        `/api/novels/${selectedNovelId}/chapters/${chapter.id}/machine-check`,
        { required_facts: brief?.required_facts ?? [] },
      );
      set({ machineCheck: result });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "机械校验失败" });
    } finally {
      set({ busy: false });
    }
  },

  async reviewChapter(decision) {
    const { selectedNovelId, selectedChapterId, busy } = get();
    if (!selectedNovelId || !selectedChapterId || busy) return;

    set({ busy: true, error: null });
    try {
      await api.post(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/final-review`,
        { decision, comments: "" },
      );
      const chapters = await api.get<Chapter[]>(`/api/novels/${selectedNovelId}/chapters`);
      set({ chapters, recordVersion: get().recordVersion + 1 });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "终审失败" });
    } finally {
      set({ busy: false });
    }
  },

  async runAiReview() {
    const { selectedNovelId, selectedChapterId, busy } = get();
    if (!selectedNovelId || !selectedChapterId || busy) return;

    set({ busy: true, error: null, notice: null });
    try {
      await api.post(`/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/auto-ai-review`);
      const chapters = await api.get<Chapter[]>(`/api/novels/${selectedNovelId}/chapters`);
      set({ chapters, recordVersion: get().recordVersion + 1, notice: "AI 七维自检完成" });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "AI 自检失败" });
    } finally {
      set({ busy: false });
    }
  },

  async extractChapterFacts() {
    const { selectedNovelId, selectedChapterId, busy } = get();
    if (!selectedNovelId || !selectedChapterId || busy) return;

    set({ busy: true, error: null, notice: null });
    try {
      await api.post(`/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/auto-summary`);
      set({ recordVersion: get().recordVersion + 1, notice: "章摘要与事实已落库" });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "事实提取失败" });
    } finally {
      set({ busy: false });
    }
  },

  async loadChapterRecords() {
    const { selectedNovelId, selectedChapterId, chapters } = get();
    if (!selectedNovelId || !selectedChapterId) {
      set({ generationRuns: [], reviews: [] });
      return;
    }
    // A chapter belongs to exactly one novel, and chapter ids are global. While a
    // novel switch is in flight the two selected ids can disagree, and the request
    // then names a pair that never existed - the server 404s it, which is the good
    // outcome; reading another book's records would be the bad one.
    if (!chapters.some((item) => item.id === selectedChapterId)) {
      set({ generationRuns: [], reviews: [] });
      return;
    }
    try {
      const [runs, reviews] = await Promise.all([
        api.get<GenerationRun[]>(
          `/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/generation-runs`,
        ),
        api.get<Review[]>(
          `/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/reviews`,
        ),
      ]);
      set({ generationRuns: runs, reviews });
    } catch {
      set({ generationRuns: [], reviews: [] });
    }
  },
}));
