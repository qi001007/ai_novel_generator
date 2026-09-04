import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ScrollText, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  isOnThumb,
  MM_PAD,
  progressFromPointer,
  thumbGeometry as sharedThumbGeometry,
} from "./minimap";

type MapVars = CSSProperties & Record<`--${string}`, string | number>;

/* Editor line metrics, mirrored in CSS below: the minimap scales the real page
   by these numbers, so the slider maps 1:1 onto the scroll position. */
const TEXT_PX = 17;
const LINE_PX = 32.3;
const TEXT_BOX = 672;

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
const TASK_LABELS: Record<string, string> = {
  draft: "正文生成",
  review: "AI 审稿",
  summary: "章摘要",
  fact_extract: "事实提取",
  chat: "对话",
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

import StatusBadge from "./StatusBadge";
import { useWorkbench } from "../store/workbench";

export default function EditorPane() {
  const navigate = useNavigate();
  const state = useWorkbench();
  const {
    selectedChapterId,
    chapters,
    draftContent,
    generationRuns,
    busy,
    notice,
  } = state;

  const chapter = chapters.find((item) => item.id === selectedChapterId) ?? null;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The textarea is the scroller: it keeps the browser's caret-into-view work,
  // and the minimap reads and writes its scrollTop. Growing it to its full
  // content height instead once produced 41707px, because scrollHeight is taken
  // while the flex row is still laid out a few dozen pixels wide.
  const scrollRef = useRef<HTMLTextAreaElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<number | null>(null);
  const [view, setView] = useState({ progress: 0, height: 1 });
  const [redraw, setRedraw] = useState(0);
  const [bottom, setBottom] = useState(readBottomPref);

  const syncView = useCallback(() => {
    const node = scrollRef.current;
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
  // Baseline is the buffer's own saved text, not the chapter record: the record
  // only refreshes after a save, and comparing against it hid edits made while a
  // generation was in flight.
  const dirty = chapter ? draftContent !== state.draftSaved : false;

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
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [syncView, selectedChapterId]);

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

  // The slider is the viewport: same proportions as the page it mirrors.
  // The map height is measured where it is used and never cached in state.
  function thumbGeometry(mapHeight: number) {
    return sharedThumbGeometry(mapHeight, view.height, view.progress);
  }

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    const host = minimapRef.current;
    const scroller = scrollRef.current;
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
    const track = Math.max(1, height - MM_PAD * 2);
    const docHeight = scroller?.scrollHeight ?? 0;
    // TEXT_BOX already nets out the textarea's 24px side padding.
    const client = scroller?.clientWidth ?? 0;
    const box = client > 96 ? Math.min(TEXT_BOX, client - 48) : TEXT_BOX;
    const perLine = Math.max(8, Math.floor(box / TEXT_PX));
    const scale = docHeight > 0 ? track / docHeight : 1;
    const row = Math.max(1, LINE_PX * scale);
    const fontSize = Math.max(1.6, Math.min(7, TEXT_PX * scale));
    const dark = document.documentElement.dataset.theme === "dark";
    ctx.font = `${fontSize}px "Noto Serif SC", "Source Han Serif SC", serif`;
    ctx.textBaseline = "top";

    let index = 0;
    for (const line of draftContent.split("\n")) {
      const body = line.trim();
      if (body) {
        const indent = line.length - line.trimStart().length ? 2 : 0;
        ctx.fillStyle = body.startsWith("#")
          ? (dark ? "#e06a4e" : "#c2492f")
          : (dark ? "rgba(157,155,150,.66)" : "rgba(115,113,108,.62)");
        for (let at = 0; at < body.length; at += perLine, index += 1) {
          ctx.fillText(
            body.slice(at, at + perLine),
            5 + indent,
            MM_PAD + index * row + Math.max(0, (row - fontSize) / 2),
          );
        }
        continue;
      }
      index += 1;
    }

    // Fade whatever the slider does not cover: the bright band is the page you see.
    const geo = thumbGeometry(height);
    ctx.fillStyle = dark ? "rgba(22,22,24,.6)" : "rgba(252,252,251,.62)";
    ctx.fillRect(0, 0, width, Math.max(0, geo.top));
    ctx.fillRect(0, geo.top + geo.height, width, Math.max(0, height - geo.top - geo.height));
  }, [draftContent, view, redraw]);

  if (!chapter) {
    return (
      <section className="editor-pane" aria-label="章节编辑">
        <div className="editor-empty">
          <h2>章节编辑</h2>
          <p>左侧选择或新建一章开始写作。</p>
        </div>
      </section>
    );
  }



  // Dragging the slider keeps the offset you grabbed it at; clicking bare track
  // centres it under the cursor. Either way it scrolls the page, not the map.
  function scrubTo(clientY: number) {
    const node = scrollRef.current;
    const map = minimapRef.current;
    if (!node || !map) return;
    const rect = map.getBoundingClientRect();
    const progress = progressFromPointer(
      rect.height,
      view.height,
      clientY,
      rect.top,
      grabRef.current,
    );
    node.scrollTop = progress * Math.max(0, node.scrollHeight - node.clientHeight);
  }

  function onMinimapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const geo = thumbGeometry(rect.height);
    const offset = event.clientY - rect.top;
    const inside = isOnThumb(rect.height, view.height, view.progress, offset);
    grabRef.current = inside ? offset - geo.top : geo.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientY);
  }

  function onMinimapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (grabRef.current !== null) scrubTo(event.clientY);
  }

  function endMinimapScrub(event: React.PointerEvent<HTMLDivElement>) {
    grabRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function startBottomDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottom.height;

    function onMove(moveEvent: PointerEvent) {
      const next = Math.min(
        BOTTOM_MAX,
        Math.max(BOTTOM_MIN, Math.round(startHeight + startY - moveEvent.clientY)),
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
      <div className="editor-tabs" role="tablist">
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
            >
              <button type="button" onClick={() => state.openChapterTab(id)}>
                第 {item.chapter_number} 章 {item.title || "未命名"}
              </button>
              {active ? <StatusBadge status={item.status} dot /> : null}
              {state.isChapterDirty(id) ? <i className="dirty-dot" aria-label="未保存" /> : null}
              <button
                type="button"
                className="editor-tab-close"
                aria-label={`关闭第 {item.chapter_number} 章`}
                onClick={() => state.closeChapterTab(id)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
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
          <button type="button" disabled={busy} onClick={() => void state.runMachineCheck()}>机械校验</button>
          <button type="button" disabled={busy} onClick={() => void state.runAiReview()}>AI 自检</button>
          <button type="button" disabled={busy} onClick={() => void state.reviewChapter("accept")}>通过终审</button>
          <button type="button" disabled={busy} onClick={() => void state.reviewChapter("reject")}>打回</button>
          <button
            type="button"
            className="primary"
            disabled={busy || chapter.status !== "final"}
            onClick={() => void state.extractChapterFacts()}
          >
            事实落库
          </button>
          {/* 批注 18: the entry point was a full-width bar sitting under the text
              whether or not anyone wanted it. One icon beside the other actions
              now opens a panel that carries its own heading. */}
          <button
            type="button"
            className="icon-button"
            aria-expanded={!bottom.collapsed}
            aria-label={bottom.collapsed ? "展开调用记录" : "收起调用记录"}
            title={bottom.collapsed ? "展开调用记录" : "收起调用记录"}
            onClick={() => setBottom((prev) => ({ ...prev, collapsed: !prev.collapsed }))}
          >
            {/* 批注 8: a clock face reads as "go back in time", not "call records". */}
            <ScrollText size={15} />
          </button>
        </div>
      </header>
      <div className="editor-body">
        <div className="editor-scroll">
          <textarea
            ref={scrollRef}
            value={draftContent}
            onChange={(event) => state.setDraftContent(event.target.value)}
            onScroll={syncView}
            aria-label="章节正文"
            spellCheck={false}
          />
        </div>
        <div
          className="minimap"
          ref={minimapRef}
          style={{ "--view-top": view.progress, "--view-height": view.height } as MapVars}
          aria-hidden="true"
          title="缩略栏：拖动透明滑块翻页"
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onMinimapPointerMove}
          onPointerUp={endMinimapScrub}
          onPointerCancel={endMinimapScrub}
        >
          <canvas ref={minimapCanvasRef} className="minimap-canvas" />
          <i className="minimap-viewport" />
        </div>
      </div>
      <div
        className="editor-bottom"
        style={bottom.collapsed ? undefined : { height: bottom.height }}
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
        {bottom.collapsed ? null : <h3 className="records-title">调用记录</h3>}
      {generationRuns.length > 0 && !bottom.collapsed && (
        <ul className="record-list" aria-label="生成与审稿记录">
            {generationRuns.map((run) => (
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
        </ul>
      )}
      </div>
    </section>
  );
}
