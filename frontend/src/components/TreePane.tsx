import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";

import StatusBadge from "./StatusBadge";
import type { Chapter, FileMeta } from "../types";
import { ARCS_PATH, BLUEPRINT_PATH, TOC_PATH, draftPath } from "../store/files";

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
  /** Every 设定库 document the server confirmed: one file per character plus the books. */
  settingFiles: FileMeta[];
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

/** One 设定库 panel plus the documents that back it. `kind` matches the server's. */
type LibraryGroup = {
  kind: string;
  label: string;
  open: boolean;
  onOpen: () => void;
  /** Reader-facing file name; characters carry their own name, books keep the path. */
  fileName: (meta: FileMeta) => string;
};

const MENU_WIDTH = 232;

export default function TreePane({
  chapters,
  selectedChapterId,
  activeFile,
  briefRows,
  settingFiles,
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
  const allCollapsed =
    collapsed.plan &&
    collapsed.library &&
    chapters.every((chapter) => collapsed[`chapter-${chapter.chapter_number}`]);
  const collapseLabel = allCollapsed ? "展开全部" : "折叠全部";

  const bookName = (meta: FileMeta) => meta.path.split("/").pop() ?? meta.path;
  const LIBRARY_GROUPS: LibraryGroup[] = [
    {
      kind: "character",
      label: "人物",
      open: charactersOpen,
      onOpen: onOpenCharacters,
      // 帧 26 的写法：陈默 · 7.md。名字给人看，路径里的 id 才是主键。
      fileName: (meta) => `${meta.label.replace(" 档案", "")} · ${bookName(meta)}`,
    },
    {
      kind: "foreshadow",
      label: "伏笔",
      open: foreshadowOpen,
      onOpen: onOpenForeshadow,
      fileName: bookName,
    },
    {
      kind: "worldview",
      label: "世界观 / 地图",
      open: worldMapOpen,
      onOpen: onOpenWorldMap,
      fileName: bookName,
    },
    {
      kind: "feedback",
      label: "反馈记录",
      open: feedbackOpen,
      onOpen: onOpenFeedback,
      fileName: bookName,
    },
  ];

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

          <div className="tree-divider">章节</div>
          {chapters.map((chapter) => {
            const key = `chapter-${chapter.chapter_number}`;
            const brief = briefRows.find((row) => row.chapter === chapter.chapter_number);
            const selected =
              chapter.id === selectedChapterId ||
              activeFile === draftPath(chapter.chapter_number) ||
              activeFile === brief?.path;
            return (
              <div key={chapter.id} className="tree-chapter">
                <div
                  className={`tree-row ${selected ? "selected" : ""}`}
                  onContextMenu={(event) =>
                    openMenu(event, { kind: "file", path: draftPath(chapter.chapter_number) })
                  }
                >
                  <button
                    type="button"
                    className="tree-prefix"
                    aria-label={`展开第 ${chapter.chapter_number} 章`}
                    aria-expanded={!collapsed[key]}
                    onClick={() => toggle(key)}
                  >
                    {collapsed[key] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <button
                    type="button"
                    className="tree-label mono"
                    title={`打开第 ${chapter.chapter_number} 章正文页`}
                    onClick={() => onSelectChapter(chapter.id)}
                  >
                    {String(chapter.chapter_number).padStart(4, "0")}
                  </button>
                  <span className="tree-hint">正文 + 简报</span>
                  <StatusBadge status={chapter.status} />
                </div>
                {!collapsed[key] && (
                  <div className="tree-children nested">
                    <button
                      type="button"
                      className={`tree-row file ${activeFile === draftPath(chapter.chapter_number) ? "selected" : ""}`}
                      onClick={() => {
                        onSelectChapter(chapter.id);
                        onOpenFile(draftPath(chapter.chapter_number));
                      }}
                    >
                      draft.md
                    </button>
                    <button
                      type="button"
                      className={`tree-row file ${activeFile === brief?.path ? "selected" : ""}`}
                      disabled={!brief}
                      title={brief ? undefined : "先写入简报后出现"}
                      onClick={() => brief && onOpenFile(brief.path)}
                    >
                      brief.md
                    </button>
                  </div>
                )}
              </div>
            );
          })}
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
          {LIBRARY_GROUPS.map((group) => {
            const files = settingFiles.filter((meta) => meta.kind === group.kind);
            return (
              <div className="tree-library" key={group.kind}>
                <button
                  type="button"
                  className={`tree-row ${group.open ? "selected" : ""}`}
                  onClick={group.onOpen}
                >
                  {group.label}
                </button>
                {/* 帧 26 A 区：面板入口保留，文档路径嵌在下面，与「人物 → 一人一个 md」同一规则。
                    路径只用 id，改名不换路径，同「章号是主键」。 */}
                {files.map((meta) => (
                  <button
                    key={meta.path}
                    type="button"
                    className={`tree-row file ${fileSelected(meta.path) ? "selected" : ""}`}
                    title={meta.path}
                    onClick={() => onOpenFile(meta.path)}
                    onContextMenu={(event) => openMenu(event, { kind: "file", path: meta.path })}
                  >
                    {group.fileName(meta)}
                  </button>
                ))}
              </div>
            );
          })}
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
          title={collapseLabel}
          aria-label={collapseLabel}
          onClick={() => {
            if (allCollapsed) {
              setCollapsed({});
              return;
            }
            const next: Record<string, boolean> = { plan: true, library: true };
            chapters.forEach((chapter) => {
              next[`chapter-${chapter.chapter_number}`] = true;
            });
            setCollapsed(next);
          }}
        >
          {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
          {collapseLabel}
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
          <button type="button" role="menuitem" className="tree-menu-item" onClick={runMenuAction(() => toggle("plan"))}>
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
