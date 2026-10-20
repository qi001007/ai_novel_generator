/* Shared minimap geometry.

Both editors draw a slider over a scaled picture of the document. They each kept
their own copy of the numbers, and the file editor's drag path ignored them
entirely: it mapped a pointer to `y / mapHeight` while the thumb travelled
`track - height` starting at `MM_PAD`. That is exactly what was reported: the thumb
jumped the moment you grabbed it, drifted under the pointer, and on a document
shorter than the pane could never reach the bottom of the track.

One implementation, two callers, draw and drag reading the same numbers.
*/

/** Padding above and below the track, mirrored in CSS as `--pad`. Zero: the
    slider has to meet the edge of the map, or it reads as a gap. */
export const MM_PAD = 0;

export type Thumb = { track: number; height: number; top: number };

const MM_THUMB_MIN = 36;
const MM_THUMB_MAX = 104;

/**
 * Where the slider sits on a map of `mapHeight` pixels. `ratio` is
 * clientHeight / scrollHeight and `progress` is 0..1 down the scrollable range -
 * not scrollTop over scrollHeight, which is what made the old thumb stop short.
 */
export function thumbGeometry(mapHeight: number, ratio: number, progress: number): Thumb {
  const track = Math.max(1, mapHeight - MM_PAD * 2);
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const minHeight = Math.min(track, MM_THUMB_MIN);
  const maxHeight = Math.min(track, MM_THUMB_MAX);
  const height = Math.max(minHeight, Math.min(maxHeight, track * clampedRatio));
  const travel = Math.max(0, track - height);
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return { track, height, top: MM_PAD + clampedProgress * travel };
}

/**
 * The inverse: which scroll position a pointer on the map means. `grab` is the
 * offset inside the thumb where the pointer landed, or null when the bare track was
 * clicked, in which case the thumb is centred under the cursor. Keeping the offset
 * is what makes it feel like dragging a slider instead of teleporting.
 */
export function progressFromPointer(
  mapHeight: number,
  ratio: number,
  clientY: number,
  mapTop: number,
  grab: number | null,
): number {
  const { track, height } = thumbGeometry(mapHeight, ratio, 0);
  const travel = Math.max(1, track - height);
  const offset = clientY - mapTop - (grab ?? height / 2);
  return Math.min(1, Math.max(0, (offset - MM_PAD) / travel));
}

/** VS Code proportional mode keeps a stable row pitch. Long documents scroll
    inside the minimap instead of being crushed until every line fits at once. */
const MM_PITCH = 3.5;
const MM_CONTENT_PAD = 4;

/**
 * One row per source line, drawn as miniature text - the picture the owner can
 * actually read. The two editors each kept their own painter: the chapter one
 * re-wrapped every line into the narrow column, which turned a page of prose into an
 * undifferentiated band, and when that band was called a seam it got dimmed to
 * near-invisible and the map stopped saying anything at all. One painter now, so
 * the two maps cannot drift apart again.
 */
export function paintMinimap(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  height: number,
  dark: boolean,
  family: string,
  accent: string,
  progress = 0,
): void {
  const contentHeight = MM_CONTENT_PAD * 2 + Math.max(1, lines.length) * MM_PITCH;
  const contentTravel = Math.max(0, contentHeight - height);
  const scrollOffset = Math.min(1, Math.max(0, progress)) * contentTravel;
  const first = Math.max(0, Math.floor((scrollOffset - MM_CONTENT_PAD) / MM_PITCH));
  const last = height <= 1
    ? lines.length
    : Math.min(lines.length, Math.ceil((scrollOffset + height) / MM_PITCH) + 1);
  const fontSize = 3.6;
  ctx.font = `${fontSize}px ${family}`;
  ctx.textBaseline = "top";
  for (let index = first; index < last; index += 1) {
    const text = lines[index] ?? "";
    const body = text.trim();
    if (!body) continue;
    const indent = Math.min((text.length - text.trimStart().length) * 0.8, 18);
    ctx.fillStyle = body.startsWith("#")
      ? accent
      : body.startsWith(">")
        ? dark
          ? "rgba(212,212,212,.58)"
          : "rgba(70,70,70,.50)"
        : dark
          ? "rgba(212,212,212,.82)"
          : "rgba(55,55,55,.76)";
    ctx.fillText(
      body.slice(0, 32),
      6 + indent,
      MM_CONTENT_PAD + index * MM_PITCH - scrollOffset,
    );
  }
}

/** True when a pointer is on the thumb rather than on bare track. */
export function isOnThumb(
  mapHeight: number,
  ratio: number,
  progress: number,
  offset: number,
): boolean {
  const { top, height } = thumbGeometry(mapHeight, ratio, progress);
  return offset >= top && offset <= top + height;
}
