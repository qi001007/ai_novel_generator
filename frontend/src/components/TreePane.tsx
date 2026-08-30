import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import StatusBadge from "./StatusBadge";
import type { Chapter } from "../types";

export type PlanningLayer = "A" | "B" | "C";

type TreePaneProps = {
  chapters: Chapter[];
  selectedChapterId: number | null;
  activePlanningLayer: PlanningLayer | null;
  charactersOpen: boolean;
  feedbackOpen: boolean;
  onOpenPlanning: (layer: PlanningLayer) => void;
  onSelectChapter: (chapterId: number) => void;
  onOpenCharacters: () => void;
  onOpenFeedback: () => void;
};

const planningNodes: { layer: PlanningLayer; label: string; hint: string }[] = [
  { layer: "A", label: "全本蓝图", hint: "长期" },
  { layer: "B", label: "目录", hint: "中期" },
  { layer: "C", label: "卷 / 剧情弧", hint: "10-30 章" },
];

export default function TreePane({
  chapters,
  selectedChapterId,
  activePlanningLayer,
  charactersOpen,
  feedbackOpen,
  onOpenPlanning,
  onSelectChapter,
  onOpenCharacters,
  onOpenFeedback,
}: TreePaneProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

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
            <button
              key={node.layer}
              type="button"
              className={`tree-row ${activePlanningLayer === node.layer ? "selected" : ""}`}
              onClick={() => onOpenPlanning(node.layer)}
            >
              <span>
                <em className="tree-prefix">{node.layer}</em>
                {node.label}
              </span>
              <span className="tree-hint">{node.hint}</span>
            </button>
          ))}
          <div className="tree-divider">章节</div>
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={`tree-row deep ${chapter.id === selectedChapterId && !activePlanningLayer ? "selected" : ""}`}
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
          <button
            type="button"
            className={`tree-row ${charactersOpen ? "selected" : ""}`}
            onClick={onOpenCharacters}
          >
            人物
          </button>
          <button
            type="button"
            className={`tree-row ${feedbackOpen ? "selected" : ""}`}
            onClick={onOpenFeedback}
          >
            反馈记录
          </button>
          <div className="tree-row static" title="P2 排期">
            世界观 / 地图
          </div>
          <div className="tree-row static" title="P2 排期">
            伏笔
          </div>
        </div>
      )}
    </nav>
  );
}
