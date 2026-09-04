import { Fragment, type ReactNode } from "react";

/**
 * The reply is prose, so it must not arrive with its markup showing: the owner has
 * asked three times about `**代价感**` reaching the screen as asterisks.
 *
 * This scans the Markdown the model actually writes into React elements - never an
 * HTML string, so model output can never become markup. The subset is deliberately
 * small: headings, fenced code, lists, blockquotes, rules, and inline code / bold /
 * italic / links. Anything else is a paragraph.
 *
 * One line is one paragraph. Joining soft-wrapped lines the way CommonMark does
 * would insert spaces that are not in Chinese prose, and the model breaks these
 * lines on purpose.
 */

const INLINE =
  /(`[^`]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]*\))/g;

function inline(raw: string, key: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let rest = raw;
  let offset = 0;
  let match = INLINE.exec(rest);
  while (match) {
    const at = match.index;
    if (at > 0) parts.push(rest.slice(0, at));
    const token = match[0];
    const id = `${key}-${offset}`;
    if (token.startsWith("`")) {
      parts.push(<code key={id}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      parts.push(<strong key={id}>{inline(token.slice(2, -2), id)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={id}>{token.slice(1, -1)}</em>);
    } else {
      const bar = token.indexOf("](");
      parts.push(
        <a key={id} href={token.slice(bar + 2, -1)} target="_blank" rel="noreferrer noopener">
          {token.slice(1, bar)}
        </a>,
      );
    }
    rest = rest.slice(at + token.length);
    offset += at + token.length;
    INLINE.lastIndex = 0;
    match = INLINE.exec(rest);
  }
  if (rest) parts.push(rest);
  return parts;
}

export default function MarkdownText({ text, tail }: { text: string; tail?: ReactNode }) {
  const lines = text.split("\n");
  // the caret belongs at the end of the last thing with words in it
  let lastContent = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== "") {
      lastContent = i;
      break;
    }
  }
  const nodes: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const items = list.items;
    nodes.push(
      list.ordered ? <ol key={`l${nodes.length}`}>{items}</ol> : <ul key={`l${nodes.length}`}>{items}</ul>,
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushList();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      nodes.push(
        <pre key={`c${i}`}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      const content = inline(heading[2], `h${i}`);
      nodes.push(
        level === 2 ? (
          <h2 key={`h${i}`}>{content}</h2>
        ) : level === 3 ? (
          <h3 key={`h${i}`}>{content}</h3>
        ) : (
          <h4 key={`h${i}`}>{content}</h4>
        ),
      );
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      flushList();
      nodes.push(<hr key={`r${i}`} />);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      flushList();
      nodes.push(
        <blockquote key={`q${i}`}>{body.map((one, n) => <Fragment key={n}>{inline(one, `q${i}-${n}`)}{n < body.length - 1 ? <br /> : null}</Fragment>)}</blockquote>,
      );
      i -= 1;
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    const number = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      const ordered = Boolean(number);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(
        <li key={`i${i}`}>{inline((bullet ?? number)![1], `i${i}`)}</li>,
      );
      continue;
    }
    flushList();
    if (line.trim() === "") continue;
    nodes.push(
      <p key={`p${i}`}>
        {inline(line, `p${i}`)}
        {i === lastContent ? tail : null}
      </p>,
    );
  }
  flushList();
  return <div className="chat-md">{nodes}</div>;
}
