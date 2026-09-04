import { describe, expect, it } from "vitest";

import {
  isOnThumb,
  MM_PAD,
  progressFromPointer,
  thumbGeometry,
} from "./minimap";

// A tall file-editor pane, measured on screen during the 批注 11 investigation.
const MAP = 618;

describe("minimap thumb geometry", () => {
  it("seats the thumb at progress 0 and flush with the track bottom at progress 1", () => {
    const top = thumbGeometry(MAP, 0.2, 0);
    expect(top.top).toBe(MM_PAD);
    const bottom = thumbGeometry(MAP, 0.2, 1);
    expect(bottom.top + bottom.height).toBeCloseTo(MAP - MM_PAD, 6);
  });

  it("keeps the thumb inside the padded track whatever the viewport ratio", () => {
    for (const ratio of [0, 0.05, 0.2, 0.6, 1]) {
      for (const progress of [0, 0.5, 1]) {
        const geo = thumbGeometry(MAP, ratio, progress);
        expect(geo.top).toBeGreaterThanOrEqual(MM_PAD - 1e-9);
        expect(geo.top + geo.height).toBeLessThanOrEqual(MAP - MM_PAD + 1e-9);
      }
    }
  });

  it("maps the thumb back to the progress it was drawn at", () => {
    const geo = thumbGeometry(MAP, 0.2, 0.37);
    expect(progressFromPointer(MAP, 0.2, geo.top, 0, 0)).toBeCloseTo(0.37, 6);
  });

  it("holds the grab offset, so a drag does not teleport the thumb", () => {
    const geo = thumbGeometry(MAP, 0.2, 0.5);
    // Pointer lands 10px into the thumb: reading it back must give 0.5, not the
    // centre of the thumb, which is what made the old drag feel sticky.
    expect(progressFromPointer(MAP, 0.2, geo.top + 10, 0, 10)).toBeCloseTo(0.5, 6);
    // Clicking bare track passes grab = null and centres the thumb under the cursor.
    const far = geo.top + geo.height + 40;
    expect(progressFromPointer(MAP, 0.2, far, 0, null)).toBeGreaterThan(0.5);
  });

  it("tells thumb from bare track", () => {
    const geo = thumbGeometry(MAP, 0.2, 0.5);
    expect(isOnThumb(MAP, 0.2, 0.5, geo.top + geo.height / 2)).toBe(true);
    expect(isOnThumb(MAP, 0.2, 0.5, geo.top - 4)).toBe(false);
  });

  it("pins the reported short-document bug: unnormalised progress stops short", () => {
    // A document 1.4 panes tall. scrollTop / scrollHeight tops out at 1 - ratio,
    // so feeding it in as progress leaves the thumb ~120px above the track bottom.
    const ratio = 1 / 1.4;
    const stale = thumbGeometry(MAP, ratio, 1 - ratio);
    const fixed = thumbGeometry(MAP, ratio, 1);
    expect(fixed.top + fixed.height - (stale.top + stale.height)).toBeGreaterThan(100);
  });
});
