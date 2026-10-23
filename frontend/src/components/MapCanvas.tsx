import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

import type { MapVersion } from "../types";
import { IconButton } from "./ui";

export type MapEdge = "east" | "west" | "north" | "south";
export type MapCell = { x: number; y: number };

const EDGES: Array<{ edge: MapEdge; label: string; short: string }> = [
  { edge: "west", label: "向西扩展一格", short: "西" },
  { edge: "north", label: "向北扩展一格", short: "北" },
  { edge: "east", label: "向东扩展一格", short: "东" },
  { edge: "south", label: "向南扩展一格", short: "南" },
];

export const MAX_TILES = 4;

function pixelSize(version: MapVersion): [number, number] {
  if (version.width && version.height) return [version.width, version.height];
  const match = /^(\d+)x(\d+)$/.exec(version.size ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [1024, 1024];
}

type MapCanvasProps = {
  name: string;
  version: MapVersion;
  selectedCell: MapCell | null;
  onSelectCell: (cell: MapCell | null) => void;
  onExpand: (edge: MapEdge) => void;
  disabled?: boolean;
};

export default function MapCanvas({
  name,
  version,
  selectedCell,
  onSelectCell,
  onExpand,
  disabled = false,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const cols = version.cols ?? 0;
  const rows = version.rows ?? 0;
  const tileable = cols > 0 && rows > 0;
  const [imageWidth, imageHeight] = pixelSize(version);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () =>
      setViewport({ width: host.clientWidth, height: host.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // A new revision may have a different canvas size; stale pan would look like a bug.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [version.revision]);

  const fit = useMemo(() => {
    if (!viewport.width || !viewport.height) return 0.5;
    return Math.min(
      (viewport.width - 80) / imageWidth,
      (viewport.height - 80) / imageHeight,
      1,
    );
  }, [viewport, imageWidth, imageHeight]);

  const scale = fit * zoom;
  const atLimit = (edge: MapEdge) =>
    edge === "east" || edge === "west" ? cols >= MAX_TILES : rows >= MAX_TILES;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    setPan({
      x: current.panX + event.clientX - current.x,
      y: current.panY + event.clientY - current.y,
    });
  };

  const stopDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={hostRef}
      className={`painting-canvas map-canvas ${dragging ? "is-dragging" : ""}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerLeave={stopDrag}
    >
      <div className="map-canvas-toolbar">
        <span className="map-canvas-gridsize tabular">
          {tileable ? `${cols} × ${rows} 格` : "整图"}
          {version.size ? ` · ${version.size}` : ""}
        </span>
        <span className="map-canvas-zoom">
          <IconButton
            type="button"
            aria-label="缩小地图"
            title="缩小"
            onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}
          >
            <Minus size={14} />
          </IconButton>
          <span className="tabular">{Math.round(scale * 100)}%</span>
          <IconButton
            type="button"
            aria-label="放大地图"
            title="放大"
            onClick={() => setZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))))}
          >
            <Plus size={14} />
          </IconButton>
          <IconButton
            type="button"
            aria-label="适应画布"
            title="适应画布"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            1:1
          </IconButton>
        </span>
      </div>

      <div className="map-canvas-viewport">
        <div
          className="map-stage"
          style={{
            width: imageWidth * scale,
            height: imageHeight * scale,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          <img
            className="painting-image map-stage-image"
            src={version.image_url}
            alt={`${name} 第 ${version.revision} 版`}
            draggable={false}
          />
          {tileable ? (
            <div
              className="map-grid"
              aria-label="地图分块"
              style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
              }}
            >
              {Array.from({ length: cols * rows }, (_, index) => {
                const x = index % cols;
                const y = Math.floor(index / cols);
                const selected = selectedCell?.x === x && selectedCell?.y === y;
                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    className={`map-grid-cell ${selected ? "selected" : ""}`}
                    aria-label={`第 ${x + 1} 列第 ${y + 1} 行`}
                    aria-pressed={selected}
                    onClick={() =>
                      onSelectCell(selected ? null : { x, y })
                    }
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {tileable ? (
        EDGES.map((item) => (
          <button
            key={item.edge}
            type="button"
            className={`map-edge map-edge-${item.edge}`}
            aria-label={item.label}
            title={
              atLimit(item.edge)
                ? item.edge === "east" || item.edge === "west"
                  ? `地图最多 ${MAX_TILES} 列`
                  : `地图最多 ${MAX_TILES} 行`
                : item.label
            }
            disabled={disabled || atLimit(item.edge)}
            onClick={() => onExpand(item.edge)}
          >
            <Plus size={14} />
            {item.short}
          </button>
        ))
      ) : (
        <p className="map-grid-note">
          这张图不是 1024 对齐的方形画布，扩图不可用；请用「方形 1024 × 1024」或「2K 方形」重新生成底图。
        </p>
      )}
    </div>
  );
}
