import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import StatusBadge from "./StatusBadge";
import type { Chapter } from "../types";
import { ARCS_PATH, BLUEPRINT_PATH, TOC_PATH } from "../store/files";

export type PlanningLayer = "A" | "B" | "C";

/** One brief file in the tree; `exists` is false for the next chapter's slot. */
export type BriefRow = { path: string; chapter: number; hint: string; exists: boolean };

type TreePaneProps = {
  chapters: Chapter[];
  selectedChapterId: number | null;
  activeFile: string | null;
  selectedPlanningLayer: PlanningLayer | null;
  briefRows: BriefRow[];
  charactersOpen: boolean;
  feedbackOpen: boolean;
  onOpenFile: (path: string) => void;
  onOpenPlanning: (layer: PlanningLayer) => void;
  onSelectChapter: (chapterId: number) => void;
  onOpenCharacters: () => void;
  onOpenFeedback: () => void;
  onOpenWorldMap: () => void;
  onOpenForeshadow: () => void;
  worldMapOpen: boolean;
  foreshadowOpen: boolean;
};

const planningNodes: { layer: PlanningLayer; path: string; label: string; hint: string }[] = [
  { layer: "A", path: BLUEPRINT_PATH, label: "全本蓝图", hint: "长期" },
  { layer: "B", path: TOC_PATH, label: "目录", hint: "中期" },
  { layer: "C", path: ARCS_PATH, label: "卷 / 剧情弧", hint: "10-30 章" },
];

export default function TreePane({
  chapters,
  selectedChapterId,
  activeFile,
  selectedPlanningLayer,
  briefRows,
  charactersOpen,
  feedbackOpen,
  onOpenFile,
  onOpenPlanning,
  onSelectChapter,
  onOpenCharacters,
  onOpenFeedback,
  onOpenWorldMap,
  onOpenForeshadow,
  worldMapOpen,
  foreshadowOpen,
}: TreePaneProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const fileSelected = (path: string) => activeFile === path;

  return (
    <nav className="tree" aria-label="项目结构">
      <button
        type="button"
        className="tree-root"
        onClick={() => toggle("plan")}
        aria-expanded={!collapsed.plan}
      >
        {collapsed.plan ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        规划
      </button>
      {!collapsed.plan && (
        <div className="tree-children">
          {planningNodes.map((node) => (
            <div
              key={node.layer}
              className={`tree-row ${
                fileSelected(node.path) || selectedPlanningLayer === node.layer ? "selected" : ""
              }`}
            >
              <button
                type="button"
                className="tree-prefix"
                title={`${node.layer} 层表单视图`}
                aria-label={`${node.label}表单视图`}
                onClick={() => onOpenPlanning(node.layer)}
              >
                {node.layer}
              </button>
              <button type="button" className="tree-label" onClick={() => onOpenFile(node.path)}>
                {node.label}
              </button>
              <span className="tree-hint">{node.hint}</span>
            </div>
          ))}

          <div
            className={`tree-row ${briefRows.some((row) => row.path === activeFile) ? "selected" : ""}`}
          >
            <button
              type="button"
              className="tree-prefix"
              title="D 层单章简报"
              aria-label="单章简报"
              onClick={() => briefRows[0] && onOpenFile(briefRows[0].path)}
            >
              D
            </button>
            <button
              type="button"
              className="tree-label"
              onClick={() => briefRows[0] && onOpenFile(briefRows[0].path)}
            >
              单章简报
            </button>
            <span className="tree-hint mono">briefs/</span>
          </div>
          {briefRows.map((row) => (
            <div
              key={row.path}
              className={`tree-row file ${fileSelected(row.path) ? "selected" : ""}`}
            >
              <button
                type="button"
                className="tree-label mono"
                onClick={() => onOpenFile(row.path)}
                title={row.path}
              >
                {row.path.slice("briefs/".length)}
              </button>
              <span className={`tree-hint ${row.exists ? "" : "muted"}`}>{row.hint}</span>
            </div>
          ))}

          <div className="tree-divider">章节</div>
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={`tree-row ${chapter.id === selectedChapterId ? "selected" : ""}`}
              onClick={() => onSelectChapter(chapter.id)}
            >
              <span className="tree-ellipsis">
                第 {chapter.chapter_number} 章 {chapter.title || "未命名"}
              </span>
              <StatusBadge status={chapter.status} />
            </button>
          ))}
          {chapters.length === 0 && <p className="tree-empty">还没有章节</p>}
        </div>
      )}

      <button
        type="button"
        className="tree-root"
        onClick={() => toggle("library")}
        aria-expanded={!collapsed.library}
      >
        {collapsed.library ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        设定库
      </button>
      {!collapsed.library && (
        <div className="tree-children">
          <button type="button" className={`tree-row ${charactersOpen ? "selected" : ""}`} onClick={onOpenCharacters}>
            人物
          </button>
          <button type="button" className={`tree-row ${feedbackOpen ? "selected" : ""}`} onClick={onOpenFeedback}>
            反馈记录
          </button>
          <button type="button" className={`tree-row ${worldMapOpen ? "selected" : ""}`} onClick={onOpenWorldMap}>
            世界观 / 地图
          </button>
          <button type="button" className={`tree-row ${foreshadowOpen ? "selected" : ""}`} onClick={onOpenForeshadow}>
            伏笔
          </button>
        </div>
      )}
    </nav>
  );
}