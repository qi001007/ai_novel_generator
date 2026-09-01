import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type PaneKey = "sidebar" | "chat";

type SplitterProps = {
  pane: PaneKey;
  label: string;
  width: number;
  min: number;
  max: number;
  collapsed: boolean;
  onDragStart: (pane: PaneKey, event: ReactPointerEvent<HTMLDivElement>) => void;
  onNudge: (pane: PaneKey, delta: number) => void;
  onToggle: (pane: PaneKey) => void;
  onReset: (pane: PaneKey) => void;
};

export default function Splitter({
  pane,
  label,
  width,
  min,
  max,
  collapsed,
  onDragStart,
  onNudge,
  onToggle,
  onReset,
}: SplitterProps) {
  return (
    <div
      className="splitter"
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
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(pane);
        }
      }}
    >
      <button
        type="button"
        className="splitter-toggle"
        aria-label={collapsed ? `展开${label}` : `折叠${label}`}
        title={collapsed ? `展开${label}` : `折叠${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onToggle(pane)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </div>
  );
}
