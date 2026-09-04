import { create } from "zustand";

import { api } from "../api";
import type { FileDoc, FileMeta, FileProposal, JumpSource } from "../types";

export const BLUEPRINT_PATH = "blueprint.md";
export const TOC_PATH = "toc.md";
export const ARCS_PATH = "arcs.md";

export const briefPath = (chapter: number) =>
  `chapters/${String(chapter).padStart(4, "0")}/brief.md`;
export const draftPath = (chapter: number) =>
  `chapters/${String(chapter).padStart(4, "0")}/draft.md`;

export const draftDocument = (chapter: number, content: string) =>
  [
    `# 第 ${chapter} 章正文`,
    "",
    "> 标题是投影结构；标题下方全部是正文内容。",
    "",
    content.trimEnd(),
    "",
  ].join("\n");

export const briefChapter = (path: string) => {
  const m = /^(?:briefs\/([0-9]{4})\.md|chapters\/([0-9]{4})\/brief\.md)$/.exec(path);
  return m ? Number(m[1]) : null;
};
export const draftChapter = (path: string) => {
  const m = /^(?:chapters\/([0-9]{4})(?:\.md|\/draft\.md)|chapters\/([0-9]{4})\/draft\.md)$/.exec(path);
  return m ? Number(m[1] ?? m[2]) : null;
};

export const TREE_LABEL: Record<string, string> = {
  blueprint: "全本蓝图",
  toc: "目录",
  arcs: "卷 / 剧情弧",
};

// B describes a chapter, D builds it. The jump lands on the D field carrying the
// same intent, so both layers keep their current wording. Field names are the
// backend ones; the Markdown labels a reader sees live in cmDoc.ts.
export const BRIEF_FIELD_OF: Record<string, string> = {
  plot_function: "goal",
  notes: "events",
};

export type FileEntry = {
  doc: FileDoc | null;
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  savedAt: string | null;
};

const emptyEntry = (): FileEntry => ({
  doc: null,
  draft: "",
  loading: false,
  saving: false,
  error: null,
  conflict: false,
  savedAt: null,
});

// Where to park the caret once a document is on screen. `seq` lets the same
// field be jumped to twice in a row and still register as new work.
export type FileFocus = { path: string; field: string; seq: number };

type FilesSet = (
  partial: Partial<FilesState> | ((state: FilesState) => Partial<FilesState>),
) => void;

type FilesState = {
  novelId: number | null;
  metas: FileMeta[];
  tabs: string[];
  active: string | null;
  entries: Record<string, FileEntry>;
  pending: Record<string, FileProposal>;
  /**
   * Which documents are showing their source instead of their rendered view.
   * One map in the store, keyed by path - 第十四批批注 2: the toggle used to exist
   * only for toc.md and only as a component-local boolean, so every other document
   * that has the same rendered-vs-source relation had no button at all.
   */
  views: Record<string, boolean>;
  jump: JumpSource | null;
  focus: FileFocus | null;
  revealSeq: number;
  metasError: string | null;
  attach: (novelId: number) => Promise<void>;
  open: (path: string, opts?: { jump?: JumpSource | null; field?: string | null }) => Promise<void>;
  reload: (path: string) => Promise<void>;
  refreshMetas: () => Promise<void>;
  setDraft: (path: string, text: string) => void;
  save: (path: string) => Promise<boolean>;
  closeTab: (path: string) => void;
  offer: (proposal: FileProposal) => void;
  applyProposal: (path: string) => Promise<boolean>;
  discardProposal: (path: string) => void;
  toggleView: (path: string) => void;
  reset: () => void;
};

let focusSeq = 0;

// The tree lists only files the server has confirmed. A brief opened from the
// "未建" slot is a projection read_file renders on the fly, not a file, so it
// must not appear in the tree until the first write actually creates it.
async function syncMetas(get: () => FilesState, set: FilesSet) {
  const novelId = get().novelId;
  if (novelId === null) return;
  try {
    set({ metas: await api.listFiles(novelId) });
  } catch {
    // A failed refresh keeps the last honest list on screen.
  }
}

function patch(state: FilesState, path: string, next: Partial<FileEntry>) {
  const prev = state.entries[path] ?? emptyEntry();
  return { entries: { ...state.entries, [path]: { ...prev, ...next } } };
}

function detail(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export const useFiles = create<FilesState>((set, get) => ({
  novelId: null,
  metas: [],
  tabs: [],
  active: null,
  entries: {},
  pending: {},
  views: {},
  jump: null,
  focus: null,
  revealSeq: 0,
  metasError: null,

  async attach(novelId) {
    if (get().novelId === novelId && get().metas.length) return;
    set({
      novelId,
      metas: [],
      tabs: [],
      active: null,
      entries: {},
      pending: {},
      views: {},
      jump: null,
      focus: null,
      revealSeq: 0,
      metasError: null,
    });
    try {
      set({ metas: await api.listFiles(novelId) });
    } catch (cause) {
      set({ metasError: detail(cause, "文件列表加载失败") });
    }
  },

  async open(path, opts = {}) {
    const { novelId, tabs, entries, revealSeq } = get();
    if (novelId === null) return;
    // Opening a file is also the gesture that brings the editor column forward.
    set({ revealSeq: revealSeq + 1,
      tabs: tabs.includes(path) ? tabs : [...tabs, path],
      active: path,
      jump: opts.jump ?? null,
      ...(opts.field ? { focus: { path, field: opts.field, seq: ++focusSeq } } : {}),
    });
    // Re-read a cached file: a stale buffer must not overwrite what the agent
    // or another tab wrote in the meantime.
    if (entries[path]?.doc && entries[path]?.draft === entries[path]?.doc?.text) {
      await get().reload(path);
      return;
    }
    if (!entries[path]?.doc) {
      set((state) => patch(state, path, { loading: true, error: null }));
      await get().reload(path);
    }
  },

  async refreshMetas() {
    await syncMetas(get, set);
  },

  async reload(path) {
    const { novelId } = get();
    if (novelId === null) return;
    set((state) => patch(state, path, { loading: true, conflict: false }));
    try {
      const doc = await api.readFile(novelId, path);
      set((state) =>
        patch(state, path, {
          doc,
          draft: doc.text,
          loading: false,
          error: null,
          conflict: false,
          savedAt: null,
        }),
      );
    } catch (cause) {
      set((state) => patch(state, path, { loading: false, error: detail(cause, "文件读取失败") }));
    }
  },

  setDraft(path, text) {
    set((state) => patch(state, path, { draft: text, savedAt: null }));
  },

  async save(path) {
    const { novelId, entries, pending } = get();
    const entry = entries[path];
    if (novelId === null || !entry?.doc || entry.saving) return false;
    if (pending[path]) {
      set((state) => patch(state, path, { error: "有提案待应用，先处理提案再保存" }));
      return false;
    }
    set((state) => patch(state, path, { saving: true, error: null, conflict: false }));
    try {
      await api.writeFile(novelId, path, entry.draft, {
        actor: "human",
        baseRevision: entry.doc.revision,
      });
      const doc = await api.readFile(novelId, path);
      set((state) =>
        patch(state, path, {
          doc,
          draft: doc.text,
          saving: false,
          error: null,
          savedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        }),
      );
      // The first write of a brief turns it into a real file: let the tree see it.
      await syncMetas(get, set);
      return true;
    } catch (cause) {
      const message = detail(cause, "保存失败");
      set((state) =>
        patch(state, path, { saving: false, error: message, conflict: /已被|409/.test(message) }),
      );
      return false;
    }
  },

  closeTab(path) {
    const tabs = get().tabs.filter((item) => item !== path);
    const active = get().active === path ? (tabs[tabs.length - 1] ?? null) : get().active;
    const entries = { ...get().entries };
    delete entries[path];
    const pending = { ...get().pending };
    delete pending[path];
    set({ tabs, active, entries, pending, ...(active === null ? { jump: null } : {}) });
  },

  offer(proposal) {
    set((state) => ({
      pending: { ...state.pending, [proposal.path]: proposal },
      // The band is drawn against the buffer the diff was computed from, so the
      // file has to be on the tab strip for the band to mean anything.
      tabs: state.tabs.includes(proposal.path) ? state.tabs : [...state.tabs, proposal.path],
    }));
  },

  async applyProposal(path) {
    const { novelId, pending } = get();
    const proposal = pending[path];
    if (novelId === null || !proposal) return false;
    try {
      await api.writeFile(novelId, path, proposal.text, {
        actor: "ai",
        baseRevision: proposal.baseRevision,
      });
    } catch (cause) {
      set((state) => patch(state, path, { error: detail(cause, "提案写入被拒") }));
      return false;
    }
    const next = { ...get().pending };
    delete next[path];
    set({ pending: next });
    await get().reload(path);
    await syncMetas(get, set);
    return true;
  },

  toggleView(path) {
    set((state) => ({ views: { ...state.views, [path]: !state.views[path] } }));
  },

  discardProposal(path) {
    const next = { ...get().pending };
    delete next[path];
    set({ pending: next });
  },

  reset() {
    set({
      novelId: null,
      metas: [],
      tabs: [],
      active: null,
      entries: {},
      pending: {},
      views: {},
      jump: null,
      focus: null,
      metasError: null,
    });
  },
}));

export const isDirty = (entry?: FileEntry) => Boolean(entry?.doc && entry.draft !== entry.doc.text);
