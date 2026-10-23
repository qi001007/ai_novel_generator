import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import { BookOpen, ScrollText, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  isOnThumb,
  paintMinimap,
  progressFromPointer,
  thumbGeometry as sharedThumbGeometry,
} from "./minimap";
import { toCssPx, tokenValue } from "../store/appearance";
import { TASK_LABELS, PURPOSE_LABELS } from "../labels";
import { formatTime } from "../utils/time";
import { api } from "../api";
import type { Review } from "../types";

type MapVars = CSSProperties & Record<`--${string}`, string | number>;

/* The face the prose is set in is read from the stylesheet rather than repeated
   here: a canvas takes no var(), and a second copy of the stack is a second answer
   to 「正文用什么字体」- the one question 19.3 turns into a control. */

/* The records panel keeps its size between reloads: it is the one region every
   run gets read in, and the default is too tall for a quick glance. */
const BOTTOM_KEY = "novelgen.editor-bottom";
const BOTTOM_MIN = 96;
const BOTTOM_MAX = 420;

function readBottomPref() {
  // 批注 17: the record list used to open on every entry, so the first thing a
  // writer saw was a panel of token accounting. It is now folded unless opened.
  const fallback = { height: 168, collapsed: true };
  try {
    const raw = window.localStorage.getItem(BOTTOM_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    return {
      height: Math.min(BOTTOM_MAX, Math.max(BOTTOM_MIN, Math.round(parsed.height ?? 168))),
      collapsed: Boolean(parsed.collapsed),
    };
  } catch {
    return fallback;
  }
}

/* The record list showed raw task keys (draft, fact_extract), which is backend
   vocabulary, not the author's. */




import HScrollThumb from "./HScrollThumb";
import ViewToggle from "./ViewToggle";
import {
  proseReviewExtensions,
  setProseReviewConfig,
  suggestionRange,
  suggestionsFromReviews,
} from "./proseReview";
import { chapterNumberLabel, draftBody, draftPath, useFiles } from "../store/files";
import { chapterDraftPath, useWorkbench } from "../store/workbench";
import { Button, Dialog, FloatingWindow, IconButton, TextField } from "./ui";

export default function EditorPane() {
  const navigate = useNavigate();
  const state = useWorkbench();
  const { selectedChapterId, chapters, generationRuns, workflowRuns, reviews, busy, notice } = state;

  const chapter = chapters.find((item) => item.id === selectedChapterId) ?? null;
  // Keep the ownership boundary here too: a stale/in-flight response must never
  // make a different chapter's calls appear under the current draft.
  const chapterRuns = chapter
    ? generationRuns.filter((run) => run.chapter_id === chapter.id)
    : [];
  const chapterWorkflowRuns = chapter
    ? workflowRuns.filter((run) => Number(run.input.chapter_id) === chapter.id)
    : [];
  const chapterRejections = chapter
    ? reviews.filter(
        (review) =>
          review.chapter_id === chapter.id &&
          review.reviewer === "human" &&
          review.decision === "reject" &&
          review.comments.trim() !== "",
      )
    : [];
  /* 批注 3.3: the prose used to live in its own `chapterDrafts` map while the file
     page held `entries["chapters/NNNN/draft.md"]`, and both wrote that one file -
     whichever saved last silently deleted the other's words. There is now a single
     buffer, the file entry, and this page reads a projection of it. */
  const draftEntry = useFiles((store) =>
    chapter ? store.entries[chapterDraftPath(chapter)] : undefined,
  );
  const draftContent = draftEntry
    ? draftBody(draftEntry.draft, chapter!.chapter_number)
    : (chapter?.content ?? "");
  const draftSaved = draftEntry?.doc
    ? draftBody(draftEntry.doc.text, chapter!.chapter_number)
    : (chapter?.content ?? "");
  /* 第十五批批注 1.4: the same pair-toggle the file strip has, on this strip too.
     One document, one button per strip that holds it, and both read the same
     `views[path]` - there is no second "am I looking at the prose" boolean. */
  const draftFilePath = chapter ? draftPath(chapter.chapter_number) : "";
  const toggleView = useFiles((store) => store.toggleView);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The textarea is the scroller: it keeps the browser's caret-into-view work,
  // and the minimap reads and writes its scrollTop. Growing it to its full
  // content height instead once produced 41707px, because scrollHeight is taken
  // while the flex row is still laid out a few dozen pixels wide.
  const editorRef = useRef<EditorView | null>(null);
  const draftContentRef = useRef(draftContent);
  const setDraftContentRef = useRef(state.setDraftContent);
  draftContentRef.current = draftContent;
  setDraftContentRef.current = state.setDraftContent;
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const [proseView, setProseView] = useState<EditorView | null>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<number | null>(null);
  const scrubFrameRef = useRef<number | null>(null);
  const [minimapDragging, setMinimapDragging] = useState(false);
  const [view, setView] = useState({ progress: 0, height: 1 });
  const [redraw, setRedraw] = useState(0);
  const [bottom, setBottom] = useState(readBottomPref);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [remediation, setRemediation] = useState<{ filename: string; markdown: string; reviewId: number } | null>(null);
  const [remediationDraft, setRemediationDraft] = useState("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const candidates = state.generationCandidates.filter((item) => item.payload.chapter_id === chapter?.id && item.novel_id === state.selectedNovelId);
  const pendingCandidates = candidates.filter((item) => item.status === "completed");
  const candidate = candidates.find((item) => item.id === candidateId);
  const [ignoredSuggestions, setIgnoredSuggestions] = useState<Set<string>>(() => new Set());
  const reviewSuggestions = useMemo(() => suggestionsFromReviews(reviews), [reviews]);
  const visibleSuggestions = useMemo(
    () => reviewSuggestions.filter((suggestion) => !ignoredSuggestions.has(suggestion.id)),
    [ignoredSuggestions, reviewSuggestions],
  );
  const selectedSuggestion = reviewSuggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ?? null;
  const selectedSuggestionRange = selectedSuggestion
    ? suggestionRange(draftContent, selectedSuggestion)
    : null;

  function replaceReviewSuggestion(
    suggestionId: string,
    change: Record<string, unknown>,
  ) {
    const current = useWorkbench.getState().reviews;
    useWorkbench.setState({
      reviews: current.map((review) => {
        const [reviewId, rawIndex] = suggestionId.split(":");
        if (review.id !== Number(reviewId)) return review;
        const suggestions = (review.evidence as Record<string, unknown>).suggestions;
        const index = Number(rawIndex);
        if (!Array.isArray(suggestions) || !Number.isInteger(index) || !suggestions[index] || typeof suggestions[index] !== "object") {
          return review;
        }
        const next = [...suggestions];
        next[index] = { ...(next[index] as Record<string, unknown>), ...change };
        return { ...review, evidence: { ...review.evidence, suggestions: next } };
      }),
    });
  }

  async function persistReviewSuggestion(
    suggestion: NonNullable<typeof selectedSuggestion>,
    change: Record<string, unknown>,
  ) {
    const novelId = useWorkbench.getState().selectedNovelId;
    const selected = useWorkbench.getState().selectedChapterId;
    if (!novelId || selected === null) return;
    try {
      const review = await api.patch<Review>(
        `/api/novels/${novelId}/chapters/${selected}/reviews/${suggestion.reviewId}/suggestions/${suggestion.index}`,
        change,
      );
      useWorkbench.setState({
        reviews: useWorkbench.getState().reviews.map((item) => item.id === review.id ? review : item),
      });
    } catch (cause) {
      useWorkbench.setState({
        error: cause instanceof Error ? cause.message : "保存审稿建议失败",
      });
    }
  }

  const syncView = useCallback(() => {
    const node = editorRef.current?.scrollDOM;
    if (!node) return;
    const { scrollTop, scrollHeight, clientHeight } = node;
    const span = scrollHeight - clientHeight;
    const next = {
      progress: span > 0 ? Math.min(1, Math.max(0, scrollTop / span)) : 0,
      height: scrollHeight > 0 ? Math.min(1, clientHeight / scrollHeight) : 1,
    };
    // Scroll fires per pixel; only re-render when the ratio actually moves.
    setView((prev) =>
      prev.progress === next.progress && prev.height === next.height ? prev : next,
    );
  }, []);
  // Baseline is the same buffer's saved text, not the chapter record: the record
  // only refreshes after a save, and comparing against it hid edits made while a
  // generation was in flight.
  const dirty = chapter ? draftContent !== draftSaved : false;

  function applyMachineIssue(index: number) {
    const issue = state.machineCheck?.issues[index];
    if (!issue?.quote || issue.replacement === undefined) return;
    let start = typeof issue.start === "number" ? issue.start : -1;
    if (start < 0 || draftContent.slice(start, start + issue.quote.length) !== issue.quote) {
      const first = draftContent.indexOf(issue.quote);
      if (first < 0 || first !== draftContent.lastIndexOf(issue.quote)) return;
      start = first;
    }
    state.setDraftContent(`${draftContent.slice(0, start)}${issue.replacement}${draftContent.slice(start + issue.quote.length)}`);
    setCheckOpen(false);
  }

  useEffect(() => {
    setSavedAt(null);
  }, [chapter?.id]);

  // The canvas is sized from live layout, so it must be repainted once the
  // browser has settled the new text and again whenever a box changes size.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncView();
      setRedraw((count) => count + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draftContent, selectedChapterId, syncView]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      syncView();
      setRedraw((count) => count + 1);
    });
    if (minimapRef.current) observer.observe(minimapRef.current);
    if (proseView) observer.observe(proseView.scrollDOM);
    return () => observer.disconnect();
  }, [proseView, syncView, selectedChapterId]);

  useEffect(() => {
    const node = proseView?.scrollDOM;
    if (!node) return undefined;
    node.addEventListener("scroll", syncView, { passive: true });
    syncView();
    return () => node.removeEventListener("scroll", syncView);
  }, [proseView, syncView]);

  // The prose page uses the same CodeMirror engine as source documents. Its only
  // writer is still the shared draft.md buffer; CodeMirror merely exposes that buffer
  // with anchor decorations instead of trying to own a second chapter string.
  useEffect(() => {
    if (!editorHost) return undefined;
    const editor = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: draftContentRef.current,
        extensions: [
          EditorView.lineWrapping,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ "aria-label": "章节正文", spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDraftContentRef.current(update.state.doc.toString());
          }),
          proseReviewExtensions,
        ],
      }),
    });
    editorRef.current = editor;
    setProseView(editor);
    return () => {
      editorRef.current = null;
      setProseView(null);
      editor.destroy();
    };
  }, [editorHost]);

  useEffect(() => {
    if (!proseView || proseView.state.doc.toString() === draftContent) return;
    proseView.dispatch({ changes: { from: 0, to: proseView.state.doc.length, insert: draftContent } });
  }, [draftContent, proseView]);

  useEffect(() => {
    if (!proseView) return;
    proseView.dispatch({
      effects: setProseReviewConfig({
        suggestions: visibleSuggestions,
        onOpen: setSelectedSuggestionId,
      }),
    });
  }, [proseView, visibleSuggestions]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void state.saveChapter().then(() => {
          if (!useWorkbench.getState().error) {
            setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
          }
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BOTTOM_KEY, JSON.stringify(bottom));
    } catch {
      // A full or blocked storage must not break the editor.
    }
  }, [bottom]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // The map is painted with theme-dependent ink, and nothing in the redraw key
  // changes when the theme does - so after a theme switch the canvas kept the old
  // marks (measured: light-theme ink left the minimap column at #AAAAAA on a dark
  // page) until the next scroll. Watch every attribute that carries a look now -
  // palette, prose face and syntax colours are all painted in here.
  useEffect(() => {
    const observer = new MutationObserver(() => setRedraw((count) => count + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-theme",
        "data-accent",
        "data-code",
        "data-prose-font",
        "data-code-font",
        // 字号不挂在属性上：它写进 html 的 style（--prose-size / --ui-zoom）
        "style",
      ],
    });
    return () => observer.disconnect();
  }, []);

  // The slider is the viewport: same proportions as the page it mirrors.
  // The map height is measured where it is used and never cached in state.
  function thumbGeometry(mapHeight: number) {
    return sharedThumbGeometry(mapHeight, view.height, view.progress);
  }

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    const host = minimapRef.current;
    if (!canvas || !host) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Scale the real page: one minimap row is one wrapped editor row.
    const dark = document.documentElement.dataset.theme === "dark";
    // 批注 1: this used to re-wrap every line into the minimap column, so the map was
    // a band of glyph soup rather than text - and when the band was reported as a
    // seam, dimming the ink made it unreadable. It draws like the file editor's map
    // now: one row per line, the same painter in both places.
    paintMinimap(ctx, draftContent.split("\n"), height, dark, tokenValue("--prose"), tokenValue("--accent"), view.progress);
  }, [draftContent, view, redraw]);

  if (!chapter) {
    return (
      <section className="editor-pane" aria-label="章节编辑">
        <div className="editor-empty">
          {/* 第十七批批注 3: §0.6 wants icon + one line, and the file column already has
              its FileCode2 - the missing block here is also why the two columns never
              looked like they shared an axis. Same glyph as the toggle's reading side. */}
          <BookOpen size={22} aria-hidden="true" />
          <h2>章节编辑</h2>
          <p>左侧选择或新建一章开始写作</p>
        </div>
      </section>
    );
  }



  // Dragging the slider keeps the offset you grabbed it at; clicking bare track
  // centres it under the cursor. Either way it scrolls the page, not the map.
  function scrubTo(clientY: number) {
    const node = editorRef.current?.scrollDOM;
    const map = minimapRef.current;
    if (!node || !map) return;
    const rect = map.getBoundingClientRect();
    // 地图高与指针都在视觉像素里，滑块几何是 CSS 像素：三样一起换算，比例才对得上
    const progress = progressFromPointer(
      toCssPx(rect.height),
      view.height,
      toCssPx(clientY),
      toCssPx(rect.top),
      grabRef.current,
    );
    const apply = () => {
      node.scrollTop = progress * Math.max(0, node.scrollHeight - node.clientHeight);
    };
    apply();
    if (scrubFrameRef.current !== null) window.cancelAnimationFrame(scrubFrameRef.current);
    // CodeMirror refines wrapped-line heights after a long jump. Re-apply once
    // with the settled scrollHeight or a click at 50% can stop around 46%.
    scrubFrameRef.current = window.requestAnimationFrame(() => {
      apply();
      scrubFrameRef.current = null;
    });
  }

  function onMinimapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const mapHeight = toCssPx(rect.height);
    const geo = thumbGeometry(mapHeight);
    const offset = toCssPx(event.clientY - rect.top);
    const inside = isOnThumb(mapHeight, view.height, view.progress, offset);
    grabRef.current = inside ? offset - geo.top : geo.height / 2;
    setMinimapDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientY);
  }

  function onMinimapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (grabRef.current !== null) scrubTo(event.clientY);
  }

  function endMinimapScrub(event: React.PointerEvent<HTMLDivElement>) {
    grabRef.current = null;
    setMinimapDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onMinimapWheel(event: React.WheelEvent<HTMLDivElement>) {
    const node = editorRef.current?.scrollDOM;
    if (!node) return;
    event.preventDefault();
    node.scrollTop += event.deltaY;
  }

  function startBottomDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottom.height;

    function onMove(moveEvent: PointerEvent) {
      const next = Math.min(
        BOTTOM_MAX,
        Math.max(BOTTOM_MIN, Math.round(startHeight + toCssPx(startY - moveEvent.clientY))),
      );
      setBottom((prev) => (prev.height === next ? prev : { ...prev, height: next }));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("chat-dock-resizing");
    }
    document.body.classList.add("chat-dock-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <section className="editor-pane" aria-label="章节编辑">
      {/* 批注 20: chapters open side by side in the strip that already names them,
         so comparing two chapters no longer means going back to the tree each
         time. Same shape as .file-tab, including the close button. */}
      <div className="editor-tabs">
        <div
          className="editor-tabs-scroll"
          role="tablist"
          ref={tabsScrollRef}
          // 批注 1 (第十轮): a vertical wheel over a horizontal strip moves the strip.
          onWheel={(event) => {
            const strip = event.currentTarget;
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            const room = strip.scrollWidth - strip.clientWidth;
            if (room <= 0) return;
            strip.scrollLeft = Math.max(0, Math.min(room, strip.scrollLeft + event.deltaY));
          }}
        >
        {state.chapterTabs.map((id) => {
          const item = state.chapters.find((each) => each.id === id);
          if (!item) return null;
          const active = id === chapter.id;
          return (
            <div
              key={id}
              className={`editor-tab ${active ? "active" : ""}`}
              role="tab"
              aria-selected={active}
              aria-label={`第 ${item.chapter_number} 章 ${item.title || "未命名"}`}
            >
              {/* 第十六批批注 3: with a few tabs open every one of them read
                  「第 … 章 …」 and was truncated to「第 …」, so the strip could not tell
                  you which chapter you were on. The tab now carries just the number the
                  tree shows; the words move to title + accessible name (§0.8 条二). */}
              <button
                type="button"
                onClick={() => state.openChapterTab(id)}
                title={`第 ${item.chapter_number} 章 ${item.title || "未命名"}`}
              >
                <span className="mono">{chapterNumberLabel(item.chapter_number)}</span>
              </button>
              {/* 批注 1: the permanent status ring is gone. It sat there whether or
                  not anything was happening, and the moment you typed, an unsaved
                  dot appeared next to it - two marks, one of which said "draft"
                  to someone already looking at a draft. The chapter's status still
                  reads in the tree, where it is comparable across chapters. */}
              {state.isChapterDirty(id) ? <i className="dirty-dot" aria-label="未保存" /> : null}
              <button
                type="button"
                className="editor-tab-close"
                aria-label={`关闭第 ${item.chapter_number} 章`}
                onClick={() => state.closeChapterTab(id)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        </div>
        {chapter ? (
          <div className="editor-tabs-actions">
            <ViewToggle path={draftFilePath} onToggle={() => toggleView(draftFilePath)} />
          </div>
        ) : null}
        <HScrollThumb scroller={tabsScrollRef} revision={state.chapterTabs.join("|")} />
      </div>
      <header className="editor-toolbar">
        {/* The tab above already says which chapter this is. Save state and the
            count live here as one quiet line instead of a band under the text. */}
        <span className="editor-status tabular">
          {dirty ? "未保存" : savedAt ? `已保存 ${savedAt}` : ""}
          {` · ${draftContent.replace(/\s/g, "").length} 字`}
        </span>
        {notice ? <span className="notice">{notice}</span> : null}
        {state.error ? <span className="status-error">{state.error}</span> : null}
        <div className="editor-actions">
          {pendingCandidates.length ? <Button compact onClick={() => setCandidateId(pendingCandidates[0].id)}>查看候选（{pendingCandidates.length}）</Button> : null}
          <Button compact disabled={busy} onClick={async () => { await state.runMachineCheck(); setCheckOpen(true); }}>错别字检查</Button>
          <Button
            compact
            loading={reviewing}
            disabled={busy}
            onClick={async () => {
              setReviewing(true);
              try {
                await state.runAiReview();
              } finally {
                setReviewing(false);
              }
            }}
          >
            AI 自检
          </Button>
          <Button
            compact
            disabled={busy || !reviews.length}
            onClick={async () => {
              const latest = reviews[reviews.length - 1];
              try {
                const report = await api.get<{ filename: string; markdown: string }>(
                  `/api/novels/${state.selectedNovelId}/chapters/${selectedChapterId}/reviews/${latest.id}/remediation-report`,
                );
                setRemediation({ ...report, reviewId: latest.id });
                setRemediationDraft(report.markdown);
              } catch (cause) {
                useWorkbench.setState({ error: cause instanceof Error ? cause.message : "整改报告生成失败" });
              }
            }}
          >
            整改报告
          </Button>
          <Button compact disabled={busy} onClick={() => void state.reviewChapter("accept")}>通过终审</Button>
          <Button compact disabled={busy || chapter.status !== "final"} onClick={() => setWithdrawOpen(true)}>撤回终审</Button>
          {/* 批注 18: the entry point was a full-width bar sitting under the text
              whether or not anyone wanted it. One icon beside the other actions
              now opens a panel that carries its own heading. */}
          <IconButton
            aria-expanded={!bottom.collapsed}
            aria-controls="editor-records"
            aria-label={bottom.collapsed ? "展开调用记录" : "收起调用记录"}
            title={bottom.collapsed ? "展开调用记录" : "收起调用记录"}
            onClick={() => setBottom((prev) => ({ ...prev, collapsed: !prev.collapsed }))}
          >
            {/* 批注 8: a clock face reads as "go back in time", not "call records". */}
            <ScrollText size={15} />
          </IconButton>
        </div>
      </header>
      <div className="editor-body">
        <div className="editor-scroll">
          <div ref={setEditorHost} className="editor-cm" />
        </div>
        <div
          className={`minimap${minimapDragging ? " dragging" : ""}`}
          ref={minimapRef}
          style={{ "--view-top": view.progress, "--view-height": view.height } as MapVars}
          role="scrollbar"
          aria-label="正文缩略栏"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.progress * 100)}
          tabIndex={0}
          title="缩略栏：拖动透明滑块翻页"
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onMinimapPointerMove}
          onPointerUp={endMinimapScrub}
          onPointerCancel={endMinimapScrub}
          onWheel={onMinimapWheel}
        >
          <canvas ref={minimapCanvasRef} className="minimap-canvas" />
          <i className="minimap-viewport" />
        </div>
      </div>
      {candidate ? <Dialog title="候选正文" onClose={() => setCandidateId(null)}>
        <p>接受后替换当前工作稿；关闭可保留候选，稍后继续查看</p>
        <div className="generation-candidate-preview">{candidate.result.content}</div>
        <p>{candidate.result.token_input} / {candidate.result.token_output} token · Workflow #{candidate.result.workflow_run_id}</p>
        {state.error ? <p role="alert">{state.error}<Button compact onClick={() => useWorkbench.setState({ error: null })}>清除提示</Button></p> : null}
        <footer>
          <Button compact onClick={() => setCandidateId(null)}>稍后处理</Button>
          <Button compact tone="primary" disabled={busy || candidate.status !== "completed"} onClick={async () => {
            await state.acceptGenerationCandidate(candidate.id);
            if (useWorkbench.getState().generationCandidates.find((item) => item.id === candidate.id)?.status === "accepted") setCandidateId(null);
          }}>接受候选</Button>
        </footer>
      </Dialog> : null}
      {remediation ? <FloatingWindow title="整改报告" onClose={() => setRemediation(null)} width={720} height={620} minWidth={360} minHeight={240}>
        <div className="remediation-panel">
          <textarea
            className="remediation-report"
            aria-label="整改报告内容"
            value={remediationDraft}
            onChange={(event) => setRemediationDraft(event.target.value)}
          />
          <footer>
            <Button compact onClick={() => setRemediation(null)}>关闭</Button>
            <Button compact loading={reportSaving} onClick={async () => {
              setReportSaving(true);
              try {
                await api.put(`/api/novels/${state.selectedNovelId}/chapters/${selectedChapterId}/reviews/${remediation.reviewId}/remediation-report`, { markdown: remediationDraft });
                useWorkbench.setState({ notice: "整改报告已保存" });
                setRemediation({ ...remediation, markdown: remediationDraft });
              } catch (cause) {
                useWorkbench.setState({ error: cause instanceof Error ? cause.message : "整改报告保存失败" });
              } finally {
                setReportSaving(false);
              }
            }}>保存</Button>
            <Button compact tone="primary" onClick={() => {
              const url = URL.createObjectURL(new Blob([remediationDraft], { type: "text/markdown;charset=utf-8" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = remediation.filename;
              link.click();
              URL.revokeObjectURL(url);
            }}>下载 .md</Button>
          </footer>
        </div>
      </FloatingWindow> : null}
      {withdrawOpen ? <Dialog title="撤回终审" onClose={() => setWithdrawOpen(false)}>
        <p>终审快照会失效，工作稿保留为 draft</p>
        <TextField autoFocus aria-label="撤回原因" placeholder="填写原因" value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} />
        <footer>
          <Button compact onClick={() => setWithdrawOpen(false)}>取消</Button>
          <Button compact tone="danger" disabled={!withdrawReason.trim() || busy} onClick={async () => { await state.reviewChapter("reject", withdrawReason.trim()); setWithdrawOpen(false); setWithdrawReason(""); }}>确认撤回</Button>
        </footer>
      </Dialog> : null}
      {checkOpen && state.machineCheck ? (
        <FloatingWindow title="错别字检查结果" onClose={() => setCheckOpen(false)} width={440} height={360}>
          <div className="spelling-summary">
            <span className="review-drawer-kicker">错别字检查</span>
            <strong>{state.machineCheck.issues.length ? `${state.machineCheck.issues.length} 个问题` : "未发现问题"}</strong>
          </div>
          <div className="spelling-issues">
            {state.machineCheck.issues.map((issue, index) => (
              <article key={`${issue.type}-${issue.start ?? index}-${index}`}>
                <strong>{issue.message}</strong>
                {issue.quote ? <div className="spelling-diff"><del>{issue.quote}</del>{issue.replacement !== undefined ? <ins>{issue.replacement || "删除"}</ins> : null}</div> : null}
                {issue.quote && issue.replacement !== undefined ? <Button compact onClick={() => applyMachineIssue(index)}>应用</Button> : null}
              </article>
            ))}
          </div>
          <p className="review-save-note">应用后只修改当前缓冲，保存前仍可撤销</p>
        </FloatingWindow>
      ) : null}
      {selectedSuggestion ? (
        <FloatingWindow title="AI 审稿建议" onClose={() => setSelectedSuggestionId(null)} width={420} minWidth={320} fitContent>
          <div className="review-suggestion-panel">
            <span className="review-drawer-kicker">AI 审稿建议</span>
            <q>{selectedSuggestion.quote}</q>
            {selectedSuggestion.comment ? <p>{selectedSuggestion.comment}</p> : null}
            <label>
              建议改为
              <textarea
                value={selectedSuggestion.replacement}
                onChange={(event) => {
                  const next = event.target.value;
                  replaceReviewSuggestion(selectedSuggestion.id, { replacement: next });
                }}
                aria-label="建议替换文本"
                rows={4}
              />
            </label>
            {selectedSuggestionRange ? null : (
              <p className="review-stale">原文已变化，不能强行应用这条建议</p>
            )}
            <div className="review-drawer-actions">
              <Button
                compact
                tone="primary"
                disabled={!selectedSuggestionRange || !selectedSuggestion.replacement}
                onClick={() => {
                  if (!selectedSuggestionRange) return;
                  state.setDraftContent(
                    `${draftContent.slice(0, selectedSuggestionRange.from)}${selectedSuggestion.replacement}${draftContent.slice(selectedSuggestionRange.to)}`,
                  );
                  replaceReviewSuggestion(selectedSuggestion.id, { status: "applied" });
                  void persistReviewSuggestion(selectedSuggestion, {
                    replacement: selectedSuggestion.replacement,
                    status: "applied",
                  });
                  setSelectedSuggestionId(null);
                  useWorkbench.setState({ notice: "已应用这条建议" });
                }}
              >
                应用这条建议
              </Button>
              <Button
                compact
                onClick={() => {
                  setIgnoredSuggestions((previous) => new Set(previous).add(selectedSuggestion.id));
                  replaceReviewSuggestion(selectedSuggestion.id, { status: "ignored" });
                  void persistReviewSuggestion(selectedSuggestion, { status: "ignored" });
                  setSelectedSuggestionId(null);
                  useWorkbench.setState({ notice: "已忽略这条建议" });
                }}
              >
                忽略
              </Button>
            </div>
            <p className="review-save-note">应用只改当前草稿；请按 Ctrl+S 保存</p>
          </div>
        </FloatingWindow>
      ) : null}
      <div
        className="editor-bottom"
        // 批注: one record should not cost 168px of panel. The dragged number is a
        // ceiling now, not a fixed height, so the region is as tall as its content.
        style={bottom.collapsed ? undefined : { maxHeight: bottom.height }}
      >
        <button
          type="button"
          className="drag-line bottom-resize"
          aria-label="调整调用记录区高度"
          title="拖动调整调用记录区高度"
          hidden={bottom.collapsed}
          onPointerDown={startBottomDrag}
        />
        {/* One slim row: the title, whatever is worth saying about the
           document, and the chevron that folds the list under it. It used to
           be two stacked rows, and once the header shortcut went away the
           extra one read as dead space. */}
        {/* The heading only exists while the panel is open, and the single door
            stays the History icon in the action row. A second "收起" button here
            was a duplicate control with a duplicate accessible name. */}
        {bottom.collapsed ? null : <h3 className="records-title" title="Workflow 生成与自检调用记录">调用记录</h3>}
        {!bottom.collapsed && (
        <ul id="editor-records" className="record-list" aria-label="生成与审稿记录">
            {chapterRejections.map((review) => (
              <li key={`rejection-${review.id}`} className="record-reject">
                <div>
                  <strong>终审打回</strong>
                  <span>{formatTime(review.created_at)}</span>
                  <p className="record-reject-reason">{review.comments}</p>
                </div>
              </li>
            ))}
            {chapterWorkflowRuns.map((run) => (
              <li key={`workflow-run-${run.id}`}>
                <div>
                  <strong>{run.workflow_name || "Workflow"}</strong>
                  <span>
                    {PURPOSE_LABELS[run.purpose] ?? (run.purpose || "运行")} ·{" "}
                    {formatTime(run.created_at)}
                  </span>
                  <span className="tabular">
                    {run.model || "未调用模型"} · {run.token_input} / {run.token_output} token
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/novels/${chapter.novel_id}/chapters/${chapter.id}/workflow-runs/${run.id}`)
                  }
                >
                  详情
                </button>
              </li>
            ))}
            {chapterRuns.map((run) => (
              <li key={`run-${run.id}`}>
                <div>
                  <strong>{run.model}</strong>
                  <span>
                    {TASK_LABELS[run.task_type] ?? run.task_type} ·{" "}
                    {formatTime(run.created_at)}
                  </span>
                  <span className="tabular">{run.token_input} / {run.token_output} token</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/novels/${chapter.novel_id}/chapters/${chapter.id}/runs/${run.id}`)
                  }
                >
                  详情
                </button>
              </li>
            ))}
            {chapterWorkflowRuns.length === 0 && chapterRuns.length === 0 && chapterRejections.length === 0
              ? <li className="empty-records">这一章还没有调用记录</li>
              : null}
        </ul>
      )}
      </div>
    </section>
  );
}
