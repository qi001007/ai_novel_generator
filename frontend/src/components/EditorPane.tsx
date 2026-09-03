import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* Editor line metrics, mirrored in CSS below: the minimap scales the real page
   by these numbers, so the slider maps 1:1 onto the scroll position. */
const MM_PAD = 8;
const TEXT_PX = 17;
const LINE_PX = 32.3;
const TEXT_BOX = 672;

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
    briefs,
    draftContent,
    generationRuns,
    busy,
    notice,
  } = state;

  const chapter = chapters.find((item) => item.id === selectedChapterId) ?? null;
  const brief = briefs.find((item) => item.id === chapter?.brief_id) ?? null;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<number | null>(null);
  const [view, setView] = useState({ progress: 0, height: 1 });
  const [mmSize, setMmSize] = useState({ w: 1, h: 1 });

  // The textarea is grown to its full content height, which hands scrolling to
  // .editor-scroll. Without this the textarea scrolls itself and the minimap
  // slider can never follow it.
  const autosize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  const measure = useCallback(() => {
    const host = minimapRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const next = {
      w: Math.max(1, Math.round(rect.width)),
      h: Math.max(1, Math.round(rect.height)),
    };
    setMmSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
  }, []);

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
  const dirty = chapter ? draftContent !== (chapter.content ?? "") : false;

  useEffect(() => {
    setSavedAt(null);
  }, [chapter?.id]);

  // Re-measure after the browser has laid out the new text.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      autosize();
      measure();
      syncView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draftContent, selectedChapterId, autosize, measure, syncView]);

  // Keep the minimap canvas and the grown textarea in step with layout changes.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      autosize();
      measure();
      syncView();
    });
    if (minimapRef.current) observer.observe(minimapRef.current);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [autosize, measure, syncView, selectedChapterId]);

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
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // The slider is the viewport: same proportions as the page it mirrors.
  function thumbGeometry() {
    const track = Math.max(1, mmSize.h - MM_PAD * 2);
    const height = Math.max(18, Math.min(track, track * view.height));
    return {
      track,
      height,
      top: MM_PAD + view.progress * Math.max(0, track - height),
    };
  }

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    const host = minimapRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !host) return;
    const rect = host.getBoundingClientRect();
    const width = mmSize.w || Math.max(1, Math.round(rect.width));
    const height = mmSize.h || Math.max(1, Math.round(rect.height));
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
    const geo = thumbGeometry();
    ctx.fillStyle = dark ? "rgba(22,22,24,.6)" : "rgba(252,252,251,.62)";
    ctx.fillRect(0, 0, width, Math.max(0, geo.top));
    ctx.fillRect(0, geo.top + geo.height, width, Math.max(0, height - geo.top - geo.height));
  }, [draftContent, mmSize, view]);

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

  const liveCount = draftContent.replace(/\s/g, "").length;
  const thumb = thumbGeometry();

  // Dragging the slider keeps the offset you grabbed it at; clicking bare track
  // centres it under the cursor. Either way it scrolls the page, not the map.
  function scrubTo(clientY: number) {
    const node = scrollRef.current;
    const map = minimapRef.current;
    if (!node || !map) return;
    const rect = map.getBoundingClientRect();
    const geo = thumbGeometry();
    const span = Math.max(1, geo.track - geo.height);
    const offset = clientY - rect.top - (grabRef.current ?? geo.height / 2);
    const progress = Math.min(1, Math.max(0, (offset - MM_PAD) / span));
    node.scrollTop = progress * Math.max(0, node.scrollHeight - node.clientHeight);
  }

  function onMinimapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const geo = thumbGeometry();
    const offset = event.clientY - rect.top;
    const inside = offset >= geo.top && offset <= geo.top + geo.height;
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

  return (
    <section className="editor-pane" aria-label="章节编辑">
      <div className="editor-tabs" role="tablist">
        <button type="button" className="editor-tab active" role="tab" aria-selected="true">
          第 {chapter.chapter_number} 章 {chapter.title || "未命名"}
          {dirty && <i className="dirty-dot" aria-label="未保存" />}
        </button>
      </div>
      <header className="editor-toolbar">
        <div className="editor-title">
          <h2>第 {chapter.chapter_number} 章 {chapter.title || "未命名"}</h2>
          <span className="editor-meta">
            D 简报{brief?.pov ? ` · 视角 ${brief.pov}` : ""} · <span className="tabular">{liveCount}</span> 字
          </span>
        </div>
        <div className="editor-actions">
          <StatusBadge status={chapter.status} />
          <button type="button" disabled={busy} onClick={() => void state.saveChapter()}>保存</button>
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
        </div>
      </header>
      <div className="editor-body">
        <div
          className="editor-scroll"
          ref={scrollRef}
          onScroll={syncView}
        >
          <textarea
            ref={textareaRef}
            value={draftContent}
            onChange={(event) => state.setDraftContent(event.target.value)}
            aria-label="章节正文"
            spellCheck={false}
          />
        </div>
        <div
          className="minimap"
          ref={minimapRef}
          aria-hidden="true"
          title="缩略栏：拖动透明滑块翻页"
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onMinimapPointerMove}
          onPointerUp={endMinimapScrub}
          onPointerCancel={endMinimapScrub}
        >
          <canvas ref={minimapCanvasRef} className="minimap-canvas" />
          <i
            className="minimap-viewport"
            style={{ top: `${thumb.top}px`, height: `${thumb.height}px` }}
          />
        </div>
      </div>
      <div className="editor-footer" aria-live="polite">
        <span className="save-state">
          {dirty ? "未保存" : savedAt ? `已保存 ${savedAt}` : "与服务器一致"}
        </span>
        {notice ? <span className="notice">{notice}</span> : null}
        {state.error ? <span className="status-error">{state.error}</span> : null}
      </div>
      {generationRuns.length > 0 && (
        <section className="records" aria-label="生成与审稿记录">
          <header className="records-head">
            <h3>调用记录</h3>
            {generationRuns.length ? (
              <button
                type="button"
                className="primary"
                onClick={() =>
                  navigate(
                    `/novels/${chapter.novel_id}/chapters/${chapter.id}/runs/${generationRuns[generationRuns.length - 1].id}`,
                  )
                }
              >
                查看调用详情
              </button>
            ) : null}
          </header>
          <ul className="record-list">
            {generationRuns.map((run) => (
              <li key={`run-${run.id}`}>
                <div>
                  <strong>{run.model}</strong>
                  <span>{run.task_type} · {formatTime(run.created_at)}</span>
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
        </section>
      )}
    </section>
  );
}
