import MarkdownText from "./MarkdownText";
import { LEVEL_LABELS } from "./CharacterLibrary";

/**
 * The rendered view of a character document (第十五批批注 3.1). The owner asked for
 * the card, not for typeset markdown: `settings/characters/6.md` read as prose is
 * still a file, and the thing he builds the file for is the card.
 *
 * It reads the buffer, not the `/characters` record, for the same reason the
 * directory list does: a rendered view that hides the reader's own unsaved words
 * makes the toggle lie about what it switched.
 */

/** The one path a character document lives at (DECISIONS D-15). */
export const isCharacterDoc = (path: string) =>
  /^settings\/characters\/[0-9]{1,6}\.md$/.test(path);

const BULLET = /^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/;
const HEADING = /^##\s+(.*)$/;

export type CharacterDoc = {
  name: string;
  level: string;
  start: string;
  end: string;
  /** The four long fields, in the order the document states them. */
  sections: { label: string; body: string }[];
};

export function parseCharacterDoc(text: string): CharacterDoc {
  const fields: Record<string, string> = {};
  const sections: { label: string; body: string }[] = [];
  let current: { label: string; lines: string[] } | null = null;

  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      if (current) sections.push({ label: current.label, body: current.lines.join("\n").trim() });
      current = { label: heading[1].trim(), lines: [] };
      continue;
    }
    if (line.startsWith("# ") || line.startsWith(">")) continue;
    const bullet = BULLET.exec(line);
    // Only the bullets above the first heading are structure: a list inside 目标 is
    // the author's own prose, and it belongs in the section it sits in.
    if (bullet && !current) {
      fields[bullet[1].trim()] = bullet[2].trim();
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ label: current.label, body: current.lines.join("\n").trim() });

  return {
    name: fields["姓名"] ?? "",
    level: fields["分级"] ?? "",
    start: fields["起始章"] ?? "",
    end: fields["结束章"] ?? "",
    sections,
  };
}

export default function CharacterDocCard({ text }: { text: string }) {
  const doc = parseCharacterDoc(text);
  const range = doc.start || doc.end ? `${doc.start || "?"} - ${doc.end || "?"} 章` : "常驻";

  return (
    <article className={`character-doc level-${doc.level || "none"}`} aria-label="人物卡片">
      <header className="character-doc-head">
        <span className="avatar large" aria-hidden="true">
          {doc.name ? doc.name.charAt(0) : "?"}
        </span>
        <span className="card-title">
          <span className="card-name">{doc.name || "未命名人物"}</span>
          <span className="card-range tabular">{range}</span>
        </span>
        <span className="level-badge">{LEVEL_LABELS[doc.level] ?? "未分级"}</span>
      </header>
      {/* One row per long field, and a field the document does not carry is simply
          not shown - "暂无身份设定" belongs on a card you can edit, not on a read
          view of a file that has nothing there yet. */}
      <dl className="character-doc-fields">
        {doc.sections.map((section) => (
          <div key={section.label}>
            <dt>{section.label}</dt>
            <dd>{section.body ? <MarkdownText text={section.body} /> : <span className="character-doc-empty">（空）</span>}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
