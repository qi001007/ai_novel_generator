import type { PointerEvent as ReactPointerEvent } from "react";

export type PaneKey = "sidebar" | "chat";

type SplitterProps = {
  pane: PaneKey;
  label: string;
  width: number;
  min: number;
  max: number;
  onDragStart: (pane: PaneKey, event: ReactPointerEvent<HTMLDivElement>) => void;
  onNudge: (pane: PaneKey, delta: number) => void;
  onReset: (pane: PaneKey) => void;
};

/**
 * A hairline, not a bar: the approved frames show no chrome between panes, so the
 * handle is 1px and only announces itself on hover or keyboard focus.
 */
export default function Splitter({
  pane,
  label,
  width,
  min,
  max,
  onDragStart,
  onNudge,
  onReset,
}: SplitterProps) {
  return (
    <div
      className="splitter"
      data-pane={pane}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`${label}宽度（拖动或方向键调整，双击复位）`}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(event) => onDragStart(pane, event)}
      onDoubleClick={() => onReset(pane)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onNudge(pane, -16);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onNudge(pane, 16);
        } else if (event.key === "Home") {
          event.preventDefault();
          onReset(pane);
        }
      }}
    />
  );
}