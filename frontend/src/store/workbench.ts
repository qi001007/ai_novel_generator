import { create } from "zustand";

import { api } from "../api";
import type {
  Chapter,
  ChapterBrief,
  ChapterGenerationResponse,
  GenerationRun,
  LLMStatus,
  MachineCheckResult,
  Novel,
  NovelUpdatePayload,
  Review,
} from "../types";

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
  draftContent: string;
  machineCheck: MachineCheckResult | null;
  generationRuns: GenerationRun[];
  reviews: Review[];
  recordVersion: number;
  error: string | null;
  notice: string | null;
  busy: boolean;
  theme: ThemeState;
  init: () => Promise<void>;
  toggleTheme: () => void;
  createNovel: (payload: { title: string; description: string; target_chapters: number; style_constraints: string }) => Promise<Novel>;
  updateNovel: (novelId: number, payload: NovelUpdatePayload) => Promise<Novel>;
  setTab: (tab: WorkspaceTab) => void;
  selectNovel: (novelId: number) => Promise<void>;
  selectBrief: (briefId: number) => void;
  selectChapter: (chapterId: number) => void;
  setDraftContent: (content: string) => void;
  generateDraft: () => Promise<void>;
  saveChapter: () => Promise<void>;
  runMachineCheck: () => Promise<void>;
  reviewChapter: (decision: "accept" | "reject") => Promise<void>;
  runAiReview: () => Promise<void>;
  extractChapterFacts: () => Promise<void>;
  loadChapterRecords: () => Promise<void>;
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
  draftContent: "",
  machineCheck: null,
  generationRuns: [],
  reviews: [],
  recordVersion: 0,
  error: null,
  notice: null,
  busy: false,
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
    const state = get();
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
      set({ novels, health: "ok", selectedNovelId: state.selectedNovelId ?? novels[0]?.id ?? null });
      const selected = get().selectedNovelId;
      if (selected !== null && selected !== state.selectedNovelId) {
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
    try {
      const [briefs, chapters] = await Promise.all([
        api.get<ChapterBrief[]>(`/api/novels/${novelId}/planning/briefs`),
        api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
      ]);
      set({
        selectedNovelId: novelId,
        briefs,
        selectedBriefId: briefs[0]?.id ?? null,
        chapters,
        selectedChapterId: chapters[0]?.id ?? null,
      });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "加载失败" });
    }
  },

  selectBrief(briefId) {
    set({ selectedBriefId: briefId });
  },

  selectChapter(chapterId) {
    set({ selectedChapterId: chapterId });
  },

  setDraftContent(content) {
    set({ draftContent: content });
  },

  async generateDraft() {
    const { selectedNovelId, selectedBriefId, busy } = get();
    if (!selectedNovelId || !selectedBriefId || busy) return;

    set({ busy: true, error: null });
    try {
      const result = await api.post<ChapterGenerationResponse>(
        `/api/novels/${selectedNovelId}/chapters/from-brief/${selectedBriefId}`,
      );
      const chapters = await api.get<Chapter[]>(`/api/novels/${selectedNovelId}/chapters`);
      set({
        chapters,
        selectedChapterId: result.chapter.id,
        machineCheck: result.machine_check,
        recordVersion: get().recordVersion + 1,
      });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "生成失败" });
    } finally {
      set({ busy: false });
    }
  },

  async saveChapter() {
    const { selectedNovelId, selectedChapterId, draftContent, busy } = get();
    const chapter = get().chapters.find((item) => item.id === selectedChapterId);
    if (!selectedNovelId || !chapter || busy) return;

    set({ busy: true, error: null });
    try {
      const updated = await api.put<Chapter>(
        `/api/novels/${selectedNovelId}/chapters/${chapter.id}`,
        {
          brief_id: chapter.brief_id,
          chapter_number: chapter.chapter_number,
          title: chapter.title,
          content: draftContent,
          status: chapter.status,
        },
      );
      set({
        chapters: get().chapters.map((item) => (item.id === updated.id ? updated : item)),
      });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "保存失败" });
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
    const { selectedNovelId, selectedChapterId } = get();
    if (!selectedNovelId || !selectedChapterId) {
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
