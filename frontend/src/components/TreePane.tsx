import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, Plus } from "lucide-react";

import StatusBadge from "./StatusBadge";
import type { Chapter } from "../types";
import { ARCS_PATH, BLUEPRINT_PATH, TOC_PATH } from "../store/files";

export type PlanningLayer = "A" | "B" | "C";

/** One brief file in the tree; `exists` is false for the next chapter's slot. */
export type BriefRow = { path: string; chapter: number; hint: string; exists: boolean };

/** What the pointer was on when the context menu opened. */
type MenuTarget = { kind: "group" } | { kind: "file"; path: string };

type MenuState = { x: number; y: number; target: MenuTarget } | null;

type TreePaneProps = {
  chapters: Chapter[];
  selectedChapterId: number | null;
  activeFile: string | null;
  briefRows: BriefRow[];
  charactersOpen: boolean;
  feedbackOpen: boolean;
  creatingChapter: boolean;
  createError: string | null;
  onOpenFile: (path: string) => void;
  onSelectChapter: (chapterId: number) => void;
  onCreateChapter: () => void;
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

const MENU_WIDTH = 232;

export default function TreePane({
  chapters,
  selectedChapterId,
  activeFile,
  briefRows,
  charactersOpen,
  feedbackOpen,
  creatingChapter,
  createError,
  onOpenFile,
  onSelectChapter,
  onCreateChapter,
  onOpenCharacters,
  onOpenFeedback,
  onOpenWorldMap,
  onOpenForeshadow,
  worldMapOpen,
  foreshadowOpen,
}: TreePaneProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const fileSelected = (path: string) => activeFile === path;

  // The menu is a fixed-position overlay, so it escapes the sidebar's overflow.
  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const openMenu = (event: React.MouseEvent, target: MenuTarget) => {
    event.preventDefault();
    const x = Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8);
    setMenu({ x: Math.max(8, x), y: event.clientY, target });
  };

  const runMenuAction = (action: () => void) => () => {
    setMenu(null);
    action();
  };

  const menuPath = menu?.target.kind === "file" ? menu.target.path : null;
  const firstBrief = briefRows[0]?.path ?? null;

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
              className={`tree-row ${fileSelected(node.path) ? "selected" : ""}`}
              onContextMenu={(event) => openMenu(event, { kind: "file", path: node.path })}
            >
              <button
                type="button"
                className="tree-prefix"
                title={`${node.layer} 层规划文档`}
                aria-label={`${node.label}（${node.layer} 层）`}
                onClick={() => onOpenFile(node.path)}
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
            onContextMenu={(event) => openMenu(event, { kind: "group" })}
          >
            <button
              type="button"
              className="tree-prefix"
              title="D 层单章简报"
              aria-label="单章简报"
              onClick={() => firstBrief && onOpenFile(firstBrief)}
            >
              D
            </button>
            <button
              type="button"
              className="tree-label"
              onClick={() => firstBrief && onOpenFile(firstBrief)}
            >
              单章简报
            </button>
            <span className="tree-hint mono">briefs/</span>
          </div>
          {!collapsed.briefs &&
            briefRows.map((row) => (
              <div
                key={row.path}
                className={`tree-row file ${fileSelected(row.path) ? "selected" : ""}`}
                onContextMenu={(event) => openMenu(event, { kind: "file", path: row.path })}
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
          {chapters.length === 0 && (
            <p className="tree-empty">
              还没有章节{" "}
              <button type="button" className="tree-inline-action" disabled={creatingChapter} onClick={onCreateChapter}>
                新建第一章
              </button>
            </p>
          )}
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

      <div className="tree-actions">
        <button
          type="button"
          className="tree-action"
          disabled={creatingChapter}
          title={creatingChapter ? "正在新建" : "新建下一章简报（Ctrl+Alt+N）"}
          aria-label="新建章节"
          onClick={onCreateChapter}
        >
          <Plus size={13} />
          {creatingChapter ? "新建中" : "新建章节"}
        </button>
        <button
          type="button"
          className="tree-action ghost"
          title="折叠全部"
          aria-label="折叠全部"
          onClick={() => setCollapsed({ plan: true, library: true, briefs: true })}
        >
          <ChevronsDownUp size={13} />
        </button>
      </div>
      {createError && <p className="tree-action-error">{createError}</p>}

      {menu && (
        <div
          ref={menuRef}
          className="tree-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}
        >
          <button type="button" role="menuitem" className="tree-menu-item primary" disabled={creatingChapter} onClick={runMenuAction(onCreateChapter)}>
            <span>新建下一章简报</span>
            <kbd>Ctrl+Alt+N</kbd>
          </button>
          <button type="button" role="menuitem" className="tree-menu-item" onClick={runMenuAction(() => toggle(menu?.target.kind === "group" ? "briefs" : "plan"))}>
            <span>折叠 / 展开</span>
            <kbd>←→</kbd>
          </button>
          <div className="tree-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="tree-menu-item"
            disabled={!menuPath}
            title={menuPath ? undefined : "分组标题没有可打开的文件"}
            onClick={runMenuAction(() => menuPath && onOpenFile(menuPath))}
          >
            <span>打开</span>
            <kbd>Enter</kbd>
          </button>
          <div className="tree-menu-sep" />
          <button type="button" role="menuitem" className="tree-menu-item" disabled title="中间插入要顺延章号，牵动文件名、目录锚点与弧范围">
            <span>在其后新建章节</span>
            <kbd>未开放</kbd>
          </button>
          <button type="button" role="menuitem" className="tree-menu-item" disabled title="重命名与删除尚未开放">
            <span>重命名 / 删除</span>
            <kbd>未开放</kbd>
          </button>
        </div>
      )}
    </nav>
  );
}