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
import { tags as t } from "@lezer/highlight";
import { yaml } from "@codemirror/lang-yaml";

import { BRIEF_FIELD_OF } from "../store/files";

// --- config ---------------------------------------------------------------

export type YamlDecorConfig = {
  /** Keys whose line gets the cinnabar rail segment: structure, not content. */
  lockedKeys: string[];
  /** 1-based lines an unapplied proposal would change. */
  pendingLines: number[];
  /** toc.yaml makes its descriptions clickable so they can open the D brief. */
  jumpFrom: boolean;
};

export const emptyConfig: YamlDecorConfig = { lockedKeys: [], pendingLines: [], jumpFrom: false };

const configEffect = StateEffect.define<YamlDecorConfig>();

const configField = StateField.define<YamlDecorConfig>({
  create: () => emptyConfig,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(configEffect)) value = effect.value;
    return value;
  },
});

export const setYamlConfig = (config: YamlDecorConfig) => configEffect.of(config);

// --- line scanning --------------------------------------------------------

// A key line is `name:` at any indent, optionally introduced by a sequence dash
// ("- chapter: 42"), which is how toc.yaml and arcs.yaml render their records.
const KEY_RE = /^(\s*)(?:-(\s+))?([A-Za-z_][A-Za-z0-9_]*)[ \t]*:([ \t]*)(.*)$/;
const BLOCK_RE = /^[|>][-+\d]*\s*(#.*)?$/;

type KeyLine = {
  line: number;
  name: string;
  /** Offset where the key text starts, so it can be painted cinnabar. */
  keyFrom: number;
  keyTo: number;
  valueFrom: number;
  valueTo: number;
  chapter: number | null;
};

/**
 * Walk the document once, tracking which `chapter:` record each line belongs to,
 * so a description in toc.yaml knows which brief file it describes.
 */
function scanKeys(view: EditorView): KeyLine[] {
  const doc = view.state.doc;
  const found: KeyLine[] = [];
  let chapter: number | null = null;
  let indent = 0;
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    const match = KEY_RE.exec(line.text);
    if (!match) continue;
    const [, lead, dash, name, gap, rest] = match;
    const depth = lead.length + (dash ? 1 + dash.length : 0);
    if (name === "chapter") {
      const digits = Number(/^\d+/.exec(rest)?.[0]);
      if (Number.isFinite(digits) && digits > 0) chapter = digits;
    }
    if (depth < indent) chapter = null;
    indent = depth;
    const keyFrom = line.from + lead.length + (dash ? 1 + dash.length : 0);
    const colon = line.text.indexOf(":", keyFrom - line.from + name.length);
    let valueTo = line.to;
    let valueFrom = line.from + colon + 1 + gap.length;
    if (BLOCK_RE.test(rest)) {
      // Block scalar: the value lives on the deeper-indented lines underneath.
      valueFrom = line.to;
      let last = line.number;
      for (let j = i + 1; j <= doc.lines; j += 1) {
        const next = doc.line(j);
        if (!next.text.trim()) {
          last = j;
          continue;
        }
        if (next.text.length - next.text.trimStart().length <= depth) break;
        last = j;
      }
      valueTo = doc.line(last).to;
    }
    found.push({ line: i, name, keyFrom, keyTo: line.from + colon, valueFrom, valueTo, chapter });
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
      for (const entry of scanKeys(view)) {
        if (config.lockedKeys.includes(entry.name)) locked.add(entry.line);
      }
      const builder = new RangeSetBuilder<RailMarker>();
      const first = view.viewport.from;
      for (const lineNo of [...locked, ...pending].sort((a, b) => a - b)) {
        const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines));
        if (line.to < first) continue;
        builder.add(
          line.from,
          line.from,
          new RailMarker(pending.has(lineNo) && !locked.has(lineNo) ? "pending" : "lock"),
        );
      }
      this.decorations = builder.finish();
    }
  },
);

export const railGutter = gutter({
  class: "cm-rail",
  markers: (view) => view.plugin(railPlugin)?.decorations ?? [],
});

// --- body decorations -----------------------------------------------------

function bodyDecorations(view: EditorView) {
  const config = view.state.field(configField);
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  const pending = new Set(config.pendingLines);
  for (const entry of scanKeys(view)) {
    ranges.push({
      from: entry.keyFrom,
      to: entry.keyTo,
      deco: Decoration.mark({ class: "cm-key" }),
    });
    if (pending.has(entry.line)) {
      const line = view.state.doc.line(entry.line);
      ranges.push({
        from: line.from,
        to: line.from,
        deco: Decoration.line({ class: "cm-pending-line", attributes: { "data-note": "\u2190 \u63d0\u6848\u5f85\u5e94\u7528" } }),
      });
    }
    if (!config.jumpFrom || entry.chapter === null) continue;
    const target = BRIEF_FIELD_OF[entry.name];
    if (!target || entry.valueTo <= entry.valueFrom) continue;
    const line = view.state.doc.line(entry.line);
    if (!line.text.slice(entry.valueFrom - line.from, entry.valueTo - line.from).trim()) continue;
    ranges.push({
      from: entry.valueFrom,
      to: entry.valueTo,
      deco: Decoration.mark({
        class: "cm-jumpable",
        attributes: { "data-jump": `${entry.chapter}:${entry.name}:${target}` },
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

export const bodyPlugin = ViewPlugin.fromClass(
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

/** Emitted when the reader clicks a description in toc.yaml. */
export const jumpHandlers = new Map<EditorView, (chapter: number, from: string, to: string) => void>();

export const clickHandlers = () =>
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

export const scrollReport = (onScroll: (info: ScrollInfo) => void) =>
  ViewPlugin.fromClass(
    class {
      dom: HTMLElement;

      handler: () => void;

      last = "";

      constructor(view: EditorView) {
        this.dom = view.scrollDOM;
        this.handler = () => this.emit(view);
        this.dom.addEventListener("scroll", this.handler, { passive: true });
        this.emit(view);
      }

      destroy() {
        this.dom.removeEventListener("scroll", this.handler);
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

/** Move the caret onto the line that declares `field`, used by the B\u2192D jump. */
export function focusField(view: EditorView, field: string): boolean {
  for (const entry of scanKeys(view)) {
    if (entry.name !== field) continue;
    const line = view.state.doc.line(entry.line);
    const head = Math.min(entry.valueTo, line.from + line.text.length);
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
// "works well with light themes": keys come out #00c and strings #a11, which on
// the graphite background are the "blue so dark you cannot read it" the owner
// flagged. Own style, every colour a theme token, so light keeps 帧 17's cinnabar
// keys and dark gets the VSCode Dark+ palette instead.
export const yamlHighlight = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName], color: "var(--tok-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--tok-string)" },
  { tag: [t.number, t.literal, t.atom, t.bool], color: "var(--tok-literal)" },
  { tag: t.comment, color: "var(--tok-comment)" },
  { tag: t.meta, color: "var(--tok-meta)" },
  { tag: t.keyword, color: "var(--tok-keyword)" },
]);

export const editorExtensions = [
  lineNumbers(),
  railGutter,
  configField,
  railPlugin,
  bodyPlugin,
  clickHandlers(),
  yaml(),
  syntaxHighlighting(yamlHighlight, { fallback: true }),
  bracketMatching(),
];