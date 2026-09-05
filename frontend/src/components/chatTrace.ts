/**
 * The model's own trace - the tool calls it made, in whatever dialect it emitted
 * them - is not prose, and it was being printed as prose: message 20 of the demo
 * book is nothing but a `[TOOL_CALL]` block, and it arrived on screen as a
 * paragraph the owner then had to read. This lifts those blocks out so the answer
 * reads as an answer and the trace folds under its own control.
 */
const BLOCK = /\[(TOOL_CALL|TOOL_RESULT|TOOL_USE)\][\s\S]*?\[\/\1\]/g;
const OPEN = /\[(TOOL_CALL|TOOL_RESULT|TOOL_USE)\]/;

export function splitTrace(text: string): { prose: string; trace: string[] } {
  const trace: string[] = [];
  const prose = text
    .replace(BLOCK, (block) => {
      trace.push(block.trim());
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Mid-stream the closing tag may not have arrived yet; an open block is not
  // readable content, so it waits rather than flashing on screen.
  const open = prose.search(OPEN);
  if (open < 0) return { prose, trace };
  return { prose: prose.slice(0, open).trim(), trace };
}

/**
 * The stored reasoning, turned into paragraphs that actually read as paragraphs
 * (第十六批之后的第十七批批注 1: 「你一个字、一两个字一行就不对」).
 *
 * A row written while the join bug was live holds one entry per streamed delta, so
 * splitting on blank lines yields "用户 / 想 / 让我 / 用" - a line per token. A real
 * paragraph break separates sentences, so the two shapes are distinguishable by how
 * long the pieces are: if the median fragment is a few characters, the text was
 * shredded and the pieces belong back together. Rows written after the fix keep their
 * structure, and the stored bytes are never rewritten.
 */
export function reasoningParagraphs(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s*\n\s*/g, "").trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const lengths = parts.map((part) => part.length).sort((a, b) => a - b);
    if (lengths[Math.floor(lengths.length / 2)] <= 4) return [parts.join("")];
  }
  return parts;
}
