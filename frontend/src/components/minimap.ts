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

/**
 * Where the slider sits on a map of `mapHeight` pixels. `ratio` is
 * clientHeight / scrollHeight and `progress` is 0..1 down the scrollable range -
 * not scrollTop over scrollHeight, which is what made the old thumb stop short.
 */
export function thumbGeometry(mapHeight: number, ratio: number, progress: number): Thumb {
  const track = Math.max(1, mapHeight - MM_PAD * 2);
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const height = Math.max(18, Math.min(track, track * clampedRatio));
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

/** Row pitch of the picture when the document is short enough to show every line
    at full size; longer documents compress below it. */
export const MM_PITCH = 5;

/**
 * One row per source line, drawn as miniature text - the picture the owner can
 * actually read. The two editors each kept their own painter: the chapter one
 * re-wrapped every line into the 56px column, which turned a page of prose into an
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
): void {
  const track = Math.max(1, height - MM_PAD * 2);
  const pitch = Math.min(MM_PITCH, track / Math.max(1, lines.length));
  const fontSize = Math.max(2, Math.min(5, pitch * 0.92));
  ctx.font = `${fontSize}px ${family}`;
  ctx.textBaseline = "top";
  lines.forEach((text, index) => {
    const body = text.trim();
    if (!body) return;
    const indent = Math.min((text.length - text.trimStart().length) * 0.8, 18);
    ctx.fillStyle = body.startsWith("#")
      ? dark
        ? "#e06a4e"
        : "#c2492f"
      : body.startsWith(">")
        ? dark
          ? "rgba(157,155,150,.35)"
          : "rgba(115,113,108,.32)"
        : dark
          ? "rgba(157,155,150,.62)"
          : "rgba(115,113,108,.58)";
    ctx.fillText(
      body.slice(0, 46),
      6 + indent,
      MM_PAD + index * pitch + Math.max(0, (pitch - fontSize) / 2),
    );
  });
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
