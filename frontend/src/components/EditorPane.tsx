import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type MapVars = CSSProperties & Record<`--${string}`, string | number>;

import StatusBadge from "./StatusBadge";
import { useWorkbench } from "../store/workbench";

export default function EditorPane() {
  const state = useWorkbench();
  const {
    selectedChapterId,
    chapters,
    briefs,
    draftContent,
    machineCheck,
    generationRuns,
    reviews,
    busy,
    notice,
  } = state;

  const chapter = chapters.find((item) => item.id === selectedChapterId) ?? null;
  const brief = briefs.find((item) => item.id === chapter?.brief_id) ?? null;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef(false);
  const [view, setView] = useState({ top: 0, height: 1 });

  const syncView = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const { scrollTop, scrollHeight, clientHeight } = node;
    const next =
      scrollHeight <= 0
        ? { top: 0, height: 1 }
        : {
            top: scrollTop / scrollHeight,
            height: Math.min(1, clientHeight / scrollHeight),
          };
    // Scroll fires per pixel; only re-render when the ratio actually moves.
    setView((prev) =>
      prev.top === next.top && prev.height === next.height ? prev : next,
    );
  }, []);
  const dirty = chapter ? draftContent !== (chapter.content ?? "") : false;

  useEffect(() => {
    setSavedAt(null);
  }, [chapter?.id]);

  // Re-measure after the browser has laid out the new text.
  useEffect(() => {
    const frame = window.requestAnimationFrame(syncView);
    return () => window.cancelAnimationFrame(frame);
  }, [draftContent, selectedChapterId, syncView]);

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

  const minimapBars = useMemo(() => {
    const raw = draftContent.split("\n").slice(0, 1200);
    const longest = Math.max(1, ...raw.map((line) => line.trim().length));
    return raw.map((line) => {
      const body = line.trim();
      return {
        indent: Math.min(line.length - line.trimStart().length, 24),
        width: body ? Math.max(6, Math.min(100, (body.length / longest) * 100)) : 0,
      };
    });
  }, [draftContent]);

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
  function scrubTo(clientY: number) {
    const node = scrollRef.current;
    const map = minimapRef.current;
    if (!node || !map) return;
    const rect = map.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    node.scrollTop = ratio * (node.scrollHeight - node.clientHeight);
  }

  function onMinimapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    scrubRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientY);
  }

  function onMinimapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (scrubRef.current) scrubTo(event.clientY);
  }

  function endMinimapScrub(event: React.PointerEvent<HTMLDivElement>) {
    scrubRef.current = false;
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
            value={draftContent}
            onChange={(event) => state.setDraftContent(event.target.value)}
            aria-label="章节正文"
            spellCheck={false}
          />
        </div>
        <div
          className="minimap"
          ref={minimapRef}
          style={{ "--lines": minimapBars.length, "--view-top": view.top, "--view-height": view.height } as MapVars}
          aria-hidden="true"
          title="缩略栏：点击或拖动可跳转正文"
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onMinimapPointerMove}
          onPointerUp={endMinimapScrub}
          onPointerCancel={endMinimapScrub}
        >
          {minimapBars.map((bar, index) =>
            bar.width > 0 ? (
              <span
                key={index}
                style={
                  {
                    "--i": index,
                    left: `${8 + Math.min(bar.indent * 1.2, 40)}%`,
                    width: `${Math.max(2, Math.min(bar.width * 0.84, 88 - Math.min(bar.indent * 1.2, 40)))}%`,
                  } as MapVars
                }
              />
            ) : null,
          )}
          <i className="minimap-thumb" />
        </div>
      </div>
      <div className="editor-footer" aria-live="polite">
        <span className="save-state">
          {dirty ? "未保存" : savedAt ? `已保存 ${savedAt}` : "与服务器一致"}
        </span>
        {notice ? <span className="notice">{notice}</span> : null}
        {state.error ? <span className="status-error">{state.error}</span> : null}
      </div>
      {machineCheck ? (
        <section className={`check-result ${machineCheck.passed ? "passed" : "failed"}`}>
          <strong>{machineCheck.passed ? "机械校验通过" : "机械校验未通过"}</strong>
          <span className="tabular">{machineCheck.word_count} 字</span>
          {machineCheck.issues.length > 0 && (
            <ul>
              {machineCheck.issues.map((issue, index) => (
                <li key={`${issue.type}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {(generationRuns.length > 0 || reviews.length > 0) && (
        <section className="records" aria-label="生成与审稿记录">
          <h3>生成与审稿记录</h3>
          <ul className="record-list">
            {generationRuns.map((run) => (
              <li key={`run-${run.id}`}>
                <strong>{run.model}</strong>
                <span>{run.task_type}</span>
                <span className="tabular">{run.token_input} / {run.token_output} token</span>
              </li>
            ))}
            {reviews.map((review) => (
              <li key={`review-${review.id}`}>
                <strong>{review.reviewer}</strong>
                <span>{review.decision}</span>
                {review.comments ? <p>{review.comments}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
