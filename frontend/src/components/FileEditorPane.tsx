import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { AlertTriangle, ChevronRight, FileCode2, RefreshCw, X } from "lucide-react";

import {
  cursorReport,
  FIELD_LABEL,
  editorExtensions,
  focusField,
  jumpHandlers,
  scrollReport,
  setDocConfig,
  type ScrollInfo,
} from "./cmDoc";
import {
  briefPath,
  hasRenderedView,
  isDirty,
  isSourceView,
  TOC_PATH,
  useFiles,
} from "../store/files";
import {
  isOnThumb,
  paintMinimap,
  progressFromPointer,
  thumbGeometry,
} from "./minimap";
import { tokenValue } from "../store/appearance";
import HScrollThumb from "./HScrollThumb";
import ViewToggle from "./ViewToggle";
import CharacterDocForm from "./CharacterDocForm";
import { isCharacterDoc } from "./CharacterFormCard";
import TocListView, { parseToc, renderToc } from "./TocListView";
import { useWorkbench } from "../store/workbench";

// The rail says "this line is structure": section headings and primary keys are
// locked for every writer, and for actor=ai so is everything else on the file.
const LOCKED_FIELDS: Record<string, string[]> = {
  blueprint: ["main_line", "ending", "core_conflicts", "themes", "constraints"],
  toc: ["chapter"],
  arcs: ["arc"],
  brief: ["chapter", "arc"],
  // A book's key line is its primary key: the writer refuses a change to it for
  // actor=ai, so the rail says so before the reader types.
  foreshadow: ["foreshadow"],
  worldview: ["setting"],
};


/* 第十四批批注 2: this used to be a set with one entry - toc.md - which is why the
   toggle existed nowhere else. Every one of these documents is markdown with a
   structural header and a body, so every one of them has a rendered view and a
   source view; the directory is only special in that its rendered view is a table
   instead of typeset prose. */

export default function FileEditorPane() {
  const novelTitle = useWorkbench((state) => {
    const found = state.novels.find((item) => item.id === state.selectedNovelId);
    return found?.title ?? "未选择作品";
  });
  const chapters = useWorkbench((state) => state.chapters);
  const tabs = useFiles((state) => state.tabs);
  const active = useFiles((state) => state.active);
  const entries = useFiles((state) => state.entries);
  const pending = useFiles((state) => state.pending);
  const jump = useFiles((state) => state.jump);
  const focus = useFiles((state) => state.focus);
  const open = useFiles((state) => state.open);
  const closeTab = useFiles((state) => state.closeTab);
  const setDraft = useFiles((state) => state.setDraft);
  const save = useFiles((state) => state.save);
  const reload = useFiles((state) => state.reload);

  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  // Offset inside the thumb where the pointer grabbed it; null when not dragging.
  const mmGrabRef = useRef(null as number | null);

  const [scroll, setScroll] = useState<ScrollInfo>({ top: 0, height: 1, lines: 0 });
  const [caretLine, setCaretLine] = useState(1);
  const [mmHeight, setMmHeight] = useState(0);
  // One view state for every document, in the store, keyed by path - so the same
  // file cannot be "source" in one pane and "rendered" in another.
  const views = useFiles((state) => state.views);
  const toggleView = useFiles((state) => state.toggleView);
  // One boolean for both tab strips - 第十五批批注 1.4: the same button appears on
  // the chapter strip too, and it reads this same map through this same function.
  const sourceView = active ? isSourceView(active, views) : false;

  // Switching to source must show the same draft the list just rendered,
  // including chapter rows that exist before their B-layer entry is saved.
  function handleToSource() {
    const entry = active ? entries[active] : undefined;
    if (active !== TOC_PATH || !entry?.doc) {
      toggleView(active!);
      return;
    }
    const parsed = parseToc(entry.draft);
    const rows = new Map(parsed.rows.map((row) => [row.chapter, row]));
    chapters.forEach((chapter) => {
      if (!rows.has(chapter.chapter_number)) {
        rows.set(chapter.chapter_number, {
          chapter: chapter.chapter_number,
          title: chapter.title || "未命名",
          plot_function: "",
          notes: "",
        });
      }
    });
    const ordered = [...rows.values()].sort((a, b) => a.chapter - b.chapter);
    const text = renderToc(parsed.preamble, ordered);
    if (text !== entry.draft) setDraft(TOC_PATH, text);
    toggleView(TOC_PATH);
  }

  const entry = active ? entries[active] : undefined;
  const proposal = active ? pending[active] : undefined;
  const kind = entry?.doc?.kind ?? "";

  /* Ctrl+S lives on the window, not only on the CodeMirror keymap. The rendered
     list is an overlay, so while it is showing the editor does not have focus and
     a keymap-bound shortcut would silently do nothing - which is the only reason
     the list kept its own 保存 button. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      const path = activeRef.current;
      if (!path) return;
      event.preventDefault();
      void save(path);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  // --- CodeMirror lives once; the store owns which document is loaded ------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          ...editorExtensions,
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const path = activeRef.current;
            if (path) setDraft(path, update.state.doc.toString());
          }),
          scrollReport(setScroll),
          cursorReport(setCaretLine),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                const path = activeRef.current;
                if (path) void save(path);
                return true;
              },
            },
          ]),
        ],
      }),
    });
    viewRef.current = view;
    jumpHandlers.set(view, (chapter, from, to) => {
      const path = activeRef.current;
      void open(briefPath(chapter), {
        jump: path ? { fromPath: path, chapter, field: from } : null,
        field: to,
      });
    });
    return () => {
      jumpHandlers.delete(view);
      view.destroy();
      viewRef.current = null;
    };
  }, [open, save, setDraft]);

  // --- load the active document into the buffer ---------------------------
  const draft = entry?.draft ?? "";
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !entry?.doc) return;
    if (view.state.doc.toString() !== entry.draft) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.draft } });
    }
  }, [active, draft, entry?.doc]);

  // --- rail + pending + jumpable depend on which file is on screen --------
  const pendingLines = useMemo(() => {
    if (!proposal || !entry?.doc) return [];
    const before = entry.doc.text.split("\n");
    const after = proposal.text.split("\n");
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
      tail += 1;
    }
    const changed: number[] = [];
    for (let i = head; i < before.length - tail; i += 1) changed.push(i + 1);
    return changed;
  }, [proposal, entry?.doc]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setDocConfig({
        lockedFields: LOCKED_FIELDS[kind] ?? [],
        pendingLines,
        jumpFrom: kind === "toc",
      }),
    });
  }, [kind, pendingLines, active]);

  // --- the B→D jump parks the caret on the mapped field -------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !focus || !entry?.doc || focus.path !== active) return;
    const timer = window.setTimeout(() => focusField(view, focus.field), 0);
    return () => window.clearTimeout(timer);
  }, [focus, active, entry?.doc]);

  // --- minimap geometry ---------------------------------------------------
  const lines = useMemo(() => draft.split("\n"), [draft]);

  // Progress down the scrollable range. scrollReport reports top as
  // scrollTop / scrollHeight, so on a document only slightly taller than the pane
  // it tops out at 1 - height, well short of 1: the thumb could never reach the
  // bottom of the track, which is the "只能滑一部分" that was reported. Dividing by
  // (1 - height) normalises it. Same convention EditorPane already uses.
  const scrollProgress =
    scroll.height >= 1 ? 0 : scroll.top / (1 - scroll.height);

  // Dragging turns the page, not the picture. Draw and drag read the same three
  // numbers, so the thumb sits under the cursor from the first pixel instead of
  // jumping there.
  function scrubTo(clientY: number, mapTop: number) {
    const view = viewRef.current;
    if (!view) return;
    const dom = view.scrollDOM;
    const progress = progressFromPointer(
      mmHeight,
      scroll.height,
      clientY,
      mapTop,
      mmGrabRef.current,
    );
    dom.scrollTop = progress * Math.max(0, dom.scrollHeight - dom.clientHeight);
  }

  function onMinimapPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return;
    const geo = thumbGeometry(mmHeight, scroll.height, scrollProgress);
    const offset = event.clientY - rect.top;
    // On the thumb, keep the offset you grabbed; on bare track, centre it here.
    mmGrabRef.current = isOnThumb(mmHeight, scroll.height, scrollProgress, offset)
      ? offset - geo.top
      : geo.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientY, rect.top);
  }

  function onMinimapPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (mmGrabRef.current === null) return;
    scrubTo(event.clientY, event.currentTarget.getBoundingClientRect().top);
  }

  function onMinimapPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (mmGrabRef.current === null) return;
    mmGrabRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((records) => {
      setMmHeight(Math.round(records[0].contentRect.height));
    });
    observer.observe(body);
    setMmHeight(Math.round(body.getBoundingClientRect().height));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const width = 56;
    const height = Math.max(1, mmHeight);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    paintMinimap(
      ctx,
      lines,
      height,
      document.documentElement.dataset.theme === "dark",
      tokenValue("--ui"),
      tokenValue("--accent"),
    );
  }, [lines, mmHeight, caretLine, scroll]);

  const { height: thumbHeight, top: thumbTop } = thumbGeometry(
    mmHeight,
    scroll.height,
    scrollProgress,
  );

  const conflict = entry?.conflict ?? false;
  const error = entry?.error ?? null;
  const showTocList = active === TOC_PATH && Boolean(entry?.doc) && !sourceView;
  // 第十五批批注 3.1: a character file renders as the card, not as typeset markdown -
  // the card is what the file exists to fill in.
  const showCharacterCard =
    isCharacterDoc(active ?? "") && Boolean(entry?.doc) && !sourceView;
  // There is no generic "typeset markdown" overlay any more (第十六批批注 8): the only
  // renderings are the three named by hasRenderedView() - the directory table, the
  // character card, and draft.md's prose page, which is a different component entirely
  // (第十五批批注 3.2 - the owner asked for 正文, not for typeset markdown).

  if (!tabs.length) {
    return (
      <section className="file-editor" aria-label="文件编辑器">
        <div className="file-empty">
          <FileCode2 size={22} aria-hidden="true" />
          <h2>规划文件</h2>
          <p>在左边点一份文件就能改。改动会先作为提案出现，你确认后才写入</p>
        </div>
      </section>
    );
  }

  return (
    <section className="file-editor" aria-label="文件编辑器">
      <div className="file-tabs">
      <div
        className="file-tabs-scroll"
        role="tablist"
        ref={tabsScrollRef}
        // 批注 1: a vertical wheel over a horizontal strip means "move the strip",
        // not "scroll the page behind it".
        onWheel={(event) => {
          const strip = event.currentTarget;
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          const room = strip.scrollWidth - strip.clientWidth;
          if (room <= 0) return;
          strip.scrollLeft = Math.max(0, Math.min(room, strip.scrollLeft + event.deltaY));
        }}
      >
        {tabs.map((path) => {
          const item = entries[path];
          return (
            <div
              key={path}
              className={`file-tab ${path === active ? "active" : ""}`}
              role="tab"
              aria-selected={path === active}
            >
              <button type="button" onClick={() => void open(path)}>
                <span>{path}</span>
              </button>
              {isDirty(item) ? <i className="dirty-dot" aria-label="未保存" /> : null}
              {pending[path] ? <i className="pending-dot" aria-label="有提案待应用" /> : null}
              <button
                type="button"
                className="file-tab-close"
                aria-label={`关闭 ${path}`}
                onClick={() => closeTab(path)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
        {/* One persistent icon, pinned outside the scroller, for every document -
            the label says which pair it is switching (a table for the directory,
            typeset prose for everything else). */}
        {entry?.doc && hasRenderedView(active!) ? (
          <div className="file-tabs-actions">
            {/* One component now, so the chapter strip and this one cannot point
                different ways - that is what drifted before 第十六批批注 2. */}
            <ViewToggle path={active!} onToggle={() => (sourceView ? toggleView(active!) : handleToSource())} />
          </div>
        ) : null}
        <HScrollThumb scroller={tabsScrollRef} revision={tabs.join("|")} />
      </div>

      <div className="file-bar">
        {/* The group comes from the layer the server sent, not from a per-kind
            special case: every 设定 document must stop claiming to be planning. */}
        {/* A slash reads as part of the path text; a chevron reads as "goes
            inside". Same colour and size as the tab above, so the line stops
            competing with the prose underneath it. */}
        <span className="file-path">
          {novelTitle}
          <ChevronRight size={11} aria-hidden="true" />
          {entry?.doc?.layer === "设定" ? "设定库" : "规划"}
          <ChevronRight size={11} aria-hidden="true" />
          {active}
        </span>
        <span className="file-spacer" />
        {/* 批注 2: the pending-proposal sentence is deleted outright - moving the old
            foot bar's words up here was still printing words where the tab already
            shows a dot. A failed write keeps one line because nothing else says it. */}
        {error ? (
          <span className="file-bar-note error" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      {jump ? (
        <div className="jump-bar">
          <span className="jump-from">
            ↩ 来自 {jump.fromPath} · 第 {jump.chapter} 章 · {FIELD_LABEL[jump.field] ?? jump.field}
          </span>
          <span className="jump-hint">点击目录里的描述 → 打开该章简报，光标落在同一字段</span>
          <button
            type="button"
            className="jump-back"
            onClick={() => void open(jump.fromPath, { jump: null })}
          >
            返回来源
          </button>
        </div>
      ) : null}

      {conflict ? (
        <div className="file-conflict" role="alert">
          <AlertTriangle size={13} />
          <span>{error || "服务器上的文件已被别处改动"}</span>
          <button type="button" onClick={() => active && void reload(active)}>
            <RefreshCw size={12} /> 重新读取
          </button>
        </div>
      ) : null}

      <div className="file-body" ref={bodyRef}>
        {/* 批注 1: the rendered directory sits inside the body it replaces, so it
            covers it exactly instead of floating over the editor at a guessed 70px. */}
        {showTocList ? (
          <div className="toc-list-overlay">
            <TocListView />
          </div>
        ) : null}
        {/* 第十六批批注 7: this is the card the dialog uses, not a read-only copy of
            it - editable, and the photo can be changed here. It reads the buffer, so
            unsaved words still show, and it writes through the one file writer. */}
        {showCharacterCard && entry?.doc ? (
          <div className="character-doc-overlay">
            <CharacterDocForm path={active!} />
          </div>
        ) : null}
        <div className="file-code">
          {entry?.loading && !entry.doc ? <p className="file-loading">读取中…</p> : null}
          <div ref={hostRef} className="file-cm" />
        </div>
        <div
          className="minimap file-minimap"
          aria-hidden="true"
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onMinimapPointerMove}
          onPointerUp={onMinimapPointerEnd}
          onPointerCancel={onMinimapPointerEnd}
        >
          <canvas ref={minimapCanvasRef} className="minimap-canvas" />
          <i
            className="minimap-viewport"
            style={{ top: `${thumbTop}px`, height: `${thumbHeight}px` }}
          />
        </div>
      </div>

    </section>
  );
}
