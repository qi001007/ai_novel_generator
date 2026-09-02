import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { AlertTriangle, FileCode2, RefreshCw, X } from "lucide-react";

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
  isDirty,
  useFiles,
} from "../store/files";
import { useWorkbench } from "../store/workbench";

// The rail says "this line is structure": section headings and primary keys are
// locked for every writer, and for actor=ai so is everything else on the file.
const LOCKED_FIELDS: Record<string, string[]> = {
  blueprint: ["main_line", "ending", "core_conflicts", "themes", "constraints"],
  toc: ["chapter"],
  arcs: ["arc"],
  brief: ["chapter", "arc"],
};

const MM_PAD = 8;
const MM_PITCH = 5; // 2px bar + 3px gap, per frame 17

function barWidth(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 10;
  return Math.min(30, Math.max(10, [...trimmed].length));
}

export default function FileEditorPane() {
  const novelTitle = useWorkbench((state) => {
    const found = state.novels.find((item) => item.id === state.selectedNovelId);
    return found?.title ?? "未选择作品";
  });
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
  const viewRef = useRef<EditorView | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const [scroll, setScroll] = useState<ScrollInfo>({ top: 0, height: 1, lines: 0 });
  const [caretLine, setCaretLine] = useState(1);
  const [mmHeight, setMmHeight] = useState(0);

  const entry = active ? entries[active] : undefined;
  const proposal = active ? pending[active] : undefined;
  const kind = entry?.doc?.kind ?? "";

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

  const lines = useMemo(() => draft.split("\n"), [draft]);
  const track = Math.max(0, mmHeight - MM_PAD * 2);
  const pitch = lines.length ? Math.min(MM_PITCH, Math.max(2, track / lines.length)) : MM_PITCH;
  const thumbHeight = Math.max(20, Math.min(track, track * scroll.height));
  const thumbTop = MM_PAD + scroll.top * Math.max(0, track - thumbHeight);

  const dirty = isDirty(entry);
  const saving = entry?.saving ?? false;
  const conflict = entry?.conflict ?? false;
  const error = entry?.error ?? null;
  const pendingCount = Object.keys(pending).length;

  let foot: string;
  if (pendingCount) foot = `${pendingCount} 处提案待应用 · 尚未写入服务器`;
  else if (saving) foot = "写入中…";
  else if (error) foot = error;
  else if (dirty) foot = "有未保存改动 · Ctrl+S 保存";
  else if (entry?.savedAt) foot = `已保存 ${entry.savedAt}`;
  else foot = "与服务器一致";

  if (!tabs.length) {
    return (
      <section className="file-editor" aria-label="文件编辑器">
        <div className="file-empty">
          <FileCode2 size={22} />
          <h2>规划文件</h2>
          <p>左侧「规划」下的四层各对应一份 Markdown：小节标题与主键锁死，AI 只能改值，改动以提案出现。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="file-editor" aria-label="文件编辑器">
      <div className="file-tabs" role="tablist">
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
                {path}
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

      <div className="file-bar">
        <span className="file-path">{novelTitle} / 规划 / {active}</span>
        <span className="file-spacer" />
        <button
          type="button"
          className="file-save"
          disabled={!dirty || saving || Boolean(proposal)}
          title={proposal ? "先处理提案" : "保存（Ctrl+S）"}
          onClick={() => active && void save(active)}
        >
          {saving ? "写入中" : "保存"}
        </button>
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
        <div className="file-code">
          {entry?.loading && !entry.doc ? <p className="file-loading">读取中…</p> : null}
          <div ref={hostRef} className="file-cm" />
        </div>
        <div className="minimap file-minimap" aria-hidden="true">
          <i
            className="minimap-thumb"
            style={{ top: `${thumbTop}px`, height: `${thumbHeight}px` }}
          />
          {lines.map((text, index) => {
            const trimmed = text.trim();
            const tone = trimmed.startsWith("#")
              ? "heading"
              : trimmed.startsWith(">")
                ? "comment"
                : index + 1 === caretLine
                  ? "active"
                  : "";
            return (
              <i
                key={index}
                className={`minimap-ln ${tone}`}
                style={{
                  top: `${MM_PAD + index * pitch}px`,
                  left: 4,
                  width: `${barWidth(text)}px`,
                  height: `${Math.min(2, pitch)}px`,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="file-foot" aria-live="polite">
        <span>{foot}</span>
        <span className="file-foot-right tabular">
          第 {caretLine} / {lines.length} 行
        </span>
      </div>
    </section>
  );
}