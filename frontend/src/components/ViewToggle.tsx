import { BookOpen, FileCode2 } from "lucide-react";

import { isSourceView, toggleViewLabel, useFiles } from "../store/files";

/**
 * The one render/source toggle, drawn on whichever tab strip holds the document.
 * 第十五批批注 1.4 put it on both strips; 第十六批批注 2 fixed which way it points.
 *
 * The icon names what you are LOOKING AT - the book is the reading surface, the code
 * glyph is the source - because that is how the owner reads it, and he said the old
 * mapping was 「反过来」. The label keeps naming the destination ("切到源码视图"), which
 * is what the click does. Both come out of the store, so the two strips cannot drift.
 */
export default function ViewToggle({ path, onToggle }: { path: string; onToggle: () => void }) {
  const views = useFiles((state) => state.views);
  const source = isSourceView(path, views);
  const label = toggleViewLabel(path, views);
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      aria-pressed={source}
      onClick={onToggle}
    >
      {source ? <FileCode2 size={14} /> : <BookOpen size={14} />}
    </button>
  );
}
