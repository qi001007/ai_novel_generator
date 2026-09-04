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
