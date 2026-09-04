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
