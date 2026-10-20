import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import type { Review } from "../types";

export type ReviewAnchor = {
  before?: string;
  after?: string;
  occurrence?: number;
};

export type ProseSuggestion = {
  id: string;
  reviewId: number;
  index: number;
  quote: string;
  replacement: string;
  comment: string;
  status: "open" | "ignored" | "applied";
  anchor: ReviewAnchor;
};

export type SuggestionRange = { from: number; to: number };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

/** Read only the explicit suggestion payload. Evidence quotes are not suggestions. */
export function suggestionsFromReviews(reviews: Review[]): ProseSuggestion[] {
  return reviews.flatMap((review) => {
    const evidence = record(review.evidence);
    const rawSuggestions = evidence?.suggestions;
    if (!Array.isArray(rawSuggestions)) return [];
    return rawSuggestions.flatMap((raw, index) => {
      const item = record(raw);
      if (!item || typeof item.quote !== "string" || !item.quote.trim()) return [];
      const anchor = record(item.anchor);
      const status = item.status === "ignored" || item.status === "applied" ? item.status : "open";
      return [{
        id: `${review.id}:${index}`,
        reviewId: review.id,
        index,
        quote: item.quote,
        replacement: typeof item.replacement === "string" ? item.replacement : "",
        comment: typeof item.comment === "string" ? item.comment : review.comments,
        status,
        anchor: {
          before: typeof anchor?.before === "string" ? anchor.before : "",
          after: typeof anchor?.after === "string" ? anchor.after : "",
          occurrence: typeof anchor?.occurrence === "number" ? anchor.occurrence : undefined,
        },
      }];
    });
  });
}

/**
 * An old review is never allowed to become an edit by coincidence.  Its quote must
 * still be found at a unique, contextual anchor; legacy suggestions without context
 * are accepted only if the quoted text occurs exactly once.
 */
export function suggestionRange(text: string, suggestion: ProseSuggestion): SuggestionRange | null {
  if (!suggestion.quote) return null;
  const starts: number[] = [];
  for (let from = text.indexOf(suggestion.quote); from >= 0; from = text.indexOf(suggestion.quote, from + 1)) {
    const before = suggestion.anchor.before ?? "";
    const after = suggestion.anchor.after ?? "";
    const beforeMatches = !before || text.slice(Math.max(0, from - before.length), from) === before;
    const end = from + suggestion.quote.length;
    const afterMatches = !after || text.slice(end, end + after.length) === after;
    if (beforeMatches && afterMatches) starts.push(from);
  }
  if (starts.length !== 1) return null;
  return { from: starts[0], to: starts[0] + suggestion.quote.length };
}

type ReviewDecorConfig = {
  suggestions: ProseSuggestion[];
  onOpen: (id: string) => void;
};

const emptyConfig: ReviewDecorConfig = { suggestions: [], onOpen: () => undefined };
const configEffect = StateEffect.define<ReviewDecorConfig>();
const configField = StateField.define<ReviewDecorConfig>({
  create: () => emptyConfig,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(configEffect)) value = effect.value;
    return value;
  },
});

export const setProseReviewConfig = (config: ReviewDecorConfig) => configEffect.of(config);

function decorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = view.state.field(configField).suggestions
    .filter((suggestion) => suggestion.status === "open")
    .flatMap((suggestion) => {
      const range = suggestionRange(view.state.doc.toString(), suggestion);
      return range ? [{ ...range, suggestion }] : [];
    })
    .sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = -1;
  for (const range of ranges) {
    if (range.from < previousTo) continue;
    builder.add(range.from, range.to, Decoration.mark({
      class: "cm-review-mark",
      attributes: {
        "data-review-suggestion": range.suggestion.id,
        title: range.suggestion.comment || "审稿建议",
        "aria-label": "查看审稿建议",
      },
    }));
    previousTo = range.to;
  }
  return builder.finish();
}

const reviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(configEffect)))
      ) {
        this.decorations = decorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const reviewClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const mark = (event.target as HTMLElement | null)?.closest?.("[data-review-suggestion]") as HTMLElement | null;
    const id = mark?.dataset.reviewSuggestion;
    if (!id) return false;
    event.preventDefault();
    view.state.field(configField).onOpen(id);
    return true;
  },
});

export const proseReviewExtensions = [configField, reviewPlugin, reviewClickHandler];
