/**
 * CodeMirror decorations for the planning documents.
 *
 * The documents are Markdown now, so structure means a `## 小节` heading or a
 * `- **字段**：` label rather than a YAML key. Everything here keys off that: the
 * rail marks structure lines, the label paint marks the structural text, and in
 * toc.md a description becomes the click target that opens its chapter brief.
 */

import { RangeSetBuilder, StateEffect, StateField, type RangeSet } from "@codemirror/state";
import {
  Decoration,
  GutterMarker,
  ViewPlugin,
  type DecorationSet,
  EditorView,
  gutter,
  lineNumbers,
  type ViewUpdate,
} from "@codemirror/view";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";

import { BRIEF_FIELD_OF } from "../store/files";
import type { ServedGrammar } from "../types";

// --- grammar served by the projection -------------------------------------

/**
 * One document kind, indexed three ways. The rows come from the backend with
 * the projection (`markdown_doc.grammar_for_kind`); this file used to keep a
 * second, flat copy of them, and a flat copy cannot tell 目标 in a brief
 * (`goal`) from 目标 in a character sheet (`goals`). Looking the table up per
 * kind is what removes those three collisions instead of working around them.
 */
export type DocGrammar = {
  /** heading label -> field: `## 主线` is main_line */
  fieldOfHeading: Record<string, string>;
  /** bullet label -> field: `- **内容**：…` is content */
  fieldOfBullet: Record<string, string>;
  /** field -> label, for the breadcrumb that names where a jump came from */
  fieldLabels: Record<string, string>;
};

const NO_GRAMMAR: DocGrammar = {
  fieldOfHeading: {},
  fieldOfBullet: {},
  fieldLabels: {},
};

/** Drafts and chapters have no key lines, so the projection sends no rows. */
export function grammarOf(served: ServedGrammar | undefined): DocGrammar {
  const sections = served?.sections ?? [];
  const bullets = served?.bullets ?? [];
  if (!sections.length && !bullets.length) return NO_GRAMMAR;
  return {
    fieldOfHeading: Object.fromEntries(sections.map(({ field, label }) => [label, field])),
    fieldOfBullet: Object.fromEntries(bullets.map(({ field, label }) => [label, field])),
    fieldLabels: Object.fromEntries(
      [...bullets, ...sections].map(({ field, label }) => [field, label]),
    ),
  };
}

/** A key line is whatever the writer typed there, so only own properties count. */
function fieldOf(table: Record<string, string>, key: string): string {
  return Object.hasOwn(table, key) ? table[key] : "";
}

export type DocDecorConfig = {
  /** The served table for the document on screen; nothing is recognised without it. */
  grammar: DocGrammar;
  /** Fields whose line gets the rail segment: structure, not content. */
  lockedFields: string[];
  /** 1-based lines an unapplied proposal would change. */
  pendingLines: number[];
  /** toc.md makes its descriptions clickable so they can open the D brief. */
  jumpFrom: boolean;
};

const emptyConfig: DocDecorConfig = {
  grammar: NO_GRAMMAR,
  lockedFields: [],
  pendingLines: [],
  jumpFrom: false,
};

const configEffect = StateEffect.define<DocDecorConfig>();

const configField = StateField.define<DocDecorConfig>({
  create: () => emptyConfig,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(configEffect)) value = effect.value;
    return value;
  },
});

export const setDocConfig = (config: DocDecorConfig) => configEffect.of(config);

// --- document scanning ----------------------------------------------------

const HEADING_RE = /^## (.+)$/;
const BULLET_RE = /^-\s+\*\*(.+?)\*\*\s*[：:]\s*/;
const TOC_ANCHOR_RE = /^第\s*(\d+)\s*章\s*(.*)$/;
const ARC_ANCHOR_RE = /^弧\s*(\d+|\?)\s*(.*)$/;
// The settings books are records too, keyed the same way, so their key line is
// structure and gets the same rail lock.
const RECORD_ANCHOR_RES: [RegExp, string][] = [
  [ARC_ANCHOR_RE, "arc"],
  [/^伏笔\s*(\d+|\?)\s*(.*)$/, "foreshadow"],
  [/^设定\s*(\d+|\?)\s*(.*)$/, "setting"],
];

export type DocEntry = {
  line: number;
  /** Backend field name, or "" when the line is prose. */
  field: string;
  /** Where the label text sits, so it can be painted as structure. */
  keyFrom: number;
  keyTo: number;
  /** Where the editable value sits. */
  valueFrom: number;
  valueTo: number;
  /** The chapter the enclosing `## 第 N 章` anchor names. */
  chapter: number | null;
};

/**
 * Walk the document once, tracking which chapter record each line belongs to,
 * so a description in toc.md knows which brief file it describes. Exported for
 * `grammarParity.test.ts`, which checks key lines resolve through the served
 * table; nothing else should read a raw scan.
 */
export function scanDoc(view: EditorView): DocEntry[] {
  const doc = view.state.doc;
  const { grammar } = view.state.field(configField);
  const found: DocEntry[] = [];
  let chapter: number | null = null;

  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    const heading = HEADING_RE.exec(line.text);
    if (heading) {
      const text = heading[1];
      const toc = TOC_ANCHOR_RE.exec(text);
      const record = toc ? null : RECORD_ANCHOR_RES.find(([re]) => re.test(text));
      if (toc || record) {
        const [re, field] = record ?? [TOC_ANCHOR_RE, "chapter"];
        const title = (re.exec(text) as RegExpExecArray)[2].trimStart();
        const split = 3 + text.length - title.length;
        if (toc) chapter = Number(toc[1]);
        found.push({
          line: i,
          field,
          keyFrom: line.from + 3,
          keyTo: split,
          valueFrom: split,
          valueTo: line.to,
          chapter,
        });
        continue;
      }
      const field = fieldOf(grammar.fieldOfHeading, text.trim());
      chapter = null;
      found.push({
        line: i,
        field,
        keyFrom: line.from + 3,
        keyTo: line.to,
        valueFrom: line.to,
        valueTo: line.to,
        chapter: null,
      });
      continue;
    }

    const bullet = BULLET_RE.exec(line.text);
    if (!bullet) continue;
    const label = bullet[1].trim();
    const field = fieldOf(grammar.fieldOfBullet, label);
    if (field === "chapter" && line.text.includes("：")) {
      const digits = /(\d+)/.exec(line.text.slice(line.text.indexOf("：")));
      if (digits) chapter = Number(digits[1]);
    }
    const keyFrom = line.from + bullet[0].indexOf("**") + 2;
    const keyTo = keyFrom + label.length;
    found.push({
      line: i,
      field,
      keyFrom,
      keyTo,
      valueFrom: line.from + bullet[0].length,
      valueTo: line.to,
      chapter,
    });
  }
  return found;
}

// --- rail gutter ----------------------------------------------------------

class RailMarker extends GutterMarker {
  constructor(readonly kind: "lock" | "pending") {
    super();
  }

  eq(other: RailMarker) {
    return other instanceof RailMarker && other.kind === this.kind;
  }

  toDOM() {
    const node = document.createElement("div");
    node.className = `cm-rail-seg ${this.kind}`;
    return node;
  }
}

const railPlugin = ViewPlugin.fromClass(
  class {
    decorations: RangeSet<GutterMarker> = new RangeSetBuilder<RailMarker>().finish();

    constructor(view: EditorView) {
      this.mark(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(configEffect)))
      ) {
        this.mark(update.view);
      }
    }

    mark(view: EditorView) {
      const config = view.state.field(configField);
      const locked = new Set<number>();
      const pending = new Set<number>(config.pendingLines);
      for (const entry of scanDoc(view)) {
        if (config.lockedFields.includes(entry.field)) locked.add(entry.line);
      }
      const builder = new RangeSetBuilder<RailMarker>();
      const first = view.viewport.from;
      const last = view.viewport.to;
      // Gutter ranges are document positions, not line numbers.
      for (let i = view.state.doc.lineAt(first).number; i <= view.state.doc.lineAt(last).number; i += 1) {
        const marker = locked.has(i)
          ? new RailMarker("lock")
          : pending.has(i)
            ? new RailMarker("pending")
            : null;
        if (marker) builder.add(view.state.doc.line(i).from, view.state.doc.line(i).from, marker);
      }
      this.decorations = builder.finish();
    }
  },
);

const railGutter = gutter({
  class: "cm-rail",
  markers: (view) => view.plugin(railPlugin)?.decorations ?? [],
});

// --- body decorations -----------------------------------------------------

function bodyDecorations(view: EditorView) {
  const config = view.state.field(configField);
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  const pending = new Set(config.pendingLines);
  for (const entry of scanDoc(view)) {
    if (entry.keyTo > entry.keyFrom) {
      ranges.push({
        from: entry.keyFrom,
        to: entry.keyTo,
        deco: Decoration.mark({ class: "cm-key" }),
      });
    }
    if (pending.has(entry.line)) {
      const line = view.state.doc.line(entry.line);
      ranges.push({
        from: line.from,
        to: line.from,
        deco: Decoration.line({
          class: "cm-pending-line",
          attributes: { "data-note": "\u2190 \u63d0\u6848\u5f85\u5e94\u7528" },
        }),
      });
    }
    if (!config.jumpFrom || entry.chapter === null) continue;
    const target = BRIEF_FIELD_OF[entry.field];
    if (!target || entry.valueTo <= entry.valueFrom) continue;
    const line = view.state.doc.line(entry.line);
    if (!line.text.slice(entry.valueFrom - line.from, entry.valueTo - line.from).trim()) continue;
    ranges.push({
      from: entry.valueFrom,
      to: entry.valueTo,
      deco: Decoration.mark({
        class: "cm-jumpable",
        attributes: { "data-jump": `${entry.chapter}:${entry.field}:${target}` },
      }),
    });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const range of ranges) {
    if (range.from < lastTo) continue; // line decorations win over overlapping marks
    builder.add(range.from, range.to, range.deco);
    lastTo = range.to;
  }
  return builder.finish();
}

const bodyPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = bodyDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(configEffect)))
      ) {
        this.decorations = bodyDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

// --- jump + scroll plumbing ----------------------------------------------

/** Emitted when the reader clicks a description in toc.md. */
export const jumpHandlers = new Map<EditorView, (chapter: number, from: string, to: string) => void>();

const clickHandlers = () =>
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null;
      const cell = target?.closest?.("[data-jump]") as HTMLElement | null;
      if (!cell) return false;
      const [chapter, from, to] = (cell.dataset.jump ?? "").split(":");
      if (!chapter) return false;
      event.preventDefault();
      jumpHandlers.get(view)?.(Number(chapter), from, to);
      return true;
    },
  });

export type ScrollInfo = { top: number; height: number; lines: number };

/** Mirrors the editor viewport onto the minimap thumb. */
export const scrollReport = (onScroll: (info: ScrollInfo) => void) =>
  ViewPlugin.fromClass(
    class {
      handler: () => void;
      last = "";

      constructor(readonly view: EditorView) {
        const dom = view.scrollDOM;
        this.handler = () => this.emit(view);
        dom.addEventListener("scroll", this.handler, { passive: true });
        this.emit(view);
      }

      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.handler);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.geometryChanged) this.emit(update.view);
      }

      emit(view: EditorView) {
        const dom = view.scrollDOM;
        const total = dom.scrollHeight || 1;
        const next = {
          top: dom.scrollTop / total,
          height: Math.min(1, dom.clientHeight / total),
          lines: view.state.doc.lines,
        };
        const key = `${next.top.toFixed(4)}|${next.height.toFixed(4)}|${next.lines}`;
        if (key === this.last) return;
        this.last = key;
        onScroll(next);
      }
    },
  );

/** Reports the caret's 1-based line so the minimap can tint the current row. */
export const cursorReport = (onCursor: (line: number) => void) =>
  EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    onCursor(update.state.doc.lineAt(update.state.selection.main.head).number);
  });

/**
 * Move the caret onto the value behind `field`. A bullet keeps the caret on its
 * own line; a section drops it onto the first body line under the heading.
 */
export function focusField(view: EditorView, field: string): boolean {
  for (const entry of scanDoc(view)) {
    // Exact match, no label fallback: scanDoc resolved this line through the
    // table of *this* kind, so `goal` cannot be found in a character sheet.
    if (entry.field !== field) continue;
    const line = view.state.doc.line(entry.line);
    if (line.text.startsWith("## ")) {
      let head = line.to;
      for (let n = entry.line + 1; n <= view.state.doc.lines; n += 1) {
        const body = view.state.doc.line(n);
        if (body.text.startsWith("## ")) break;
        if (body.text.trim()) {
          head = body.from;
          break;
        }
      }
      view.dispatch({
        selection: { anchor: head },
        effects: EditorView.scrollIntoView(head, { y: "center" }),
      });
      view.focus();
      return true;
    }
    const head = Math.min(entry.valueTo, line.to);
    view.dispatch({
      selection: { anchor: head },
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
    view.focus();
    return true;
  }
  return false;
}

// --- syntax colours -------------------------------------------------------

// CodeMirror ships one highlight style and its own source comment says it
// "works well with light themes". Own style, every colour a theme token, so
// light keeps 帧 17's cinnabar structure and dark gets the VSCode Dark+ palette.
const docHighlight = HighlightStyle.define([
  { tag: [t.heading, t.strong], color: "var(--tok-key)", fontWeight: "bold" },
  { tag: t.contentSeparator, color: "var(--tok-key)" },
  { tag: [t.list, t.separator], color: "var(--tok-literal)" },
  { tag: t.quote, color: "var(--tok-comment)" },
  { tag: [t.link, t.monospace, t.url], color: "var(--tok-string)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.meta, color: "var(--tok-meta)" },
]);

export const editorExtensions = [
  lineNumbers(),
  railGutter,
  configField,
  railPlugin,
  bodyPlugin,
  clickHandlers(),
  markdown({ base: markdownLanguage }),
  syntaxHighlighting(docHighlight, { fallback: true }),
  bracketMatching(),
];
