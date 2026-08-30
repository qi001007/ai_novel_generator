import StatusBadge from "./StatusBadge";
import type { Chapter } from "../types";

type TreePaneProps = {
  chapters: Chapter[];
  selectedChapterId: number | null;
  onSelectChapter: (chapterId: number) => void;
};

export default function TreePane({
  chapters,
  selectedChapterId,
  onSelectChapter,
}: TreePaneProps) {
  return (
    <nav className="tree">
      <div className="tree-root">规划</div>
      <div className="tree-children">
        <div className="tree-row static">A · 全本蓝图</div>
        <div className="tree-row static">B · 目录</div>
        <div className="tree-row static">C · 卷 / 剧情弧</div>
        <div className="tree-row static">D · 章节</div>
        {chapters.map((chapter) => (
          <button
            key={chapter.id}
            type="button"
            className={`tree-row deep ${chapter.id === selectedChapterId ? "selected" : ""}`}
            onClick={() => onSelectChapter(chapter.id)}
          >
            <span>
              第 {chapter.chapter_number} 章 {chapter.title}
            </span>
            <StatusBadge status={chapter.status} />
          </button>
        ))}
      </div>
      <div className="tree-root">设定库</div>
      <div className="tree-children">
        <div className="tree-row static">人物</div>
        <div className="tree-row static">世界观</div>
        <div className="tree-row static">伏笔</div>
      </div>
    </nav>
  );
}
