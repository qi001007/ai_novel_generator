import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Globe,
  Plus,
  Search,
  StickyNote,
  Users,
  X,
} from "lucide-react";
import type { RailPage } from "./ActivityRail";

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
  /** 帧 27: the sidebar holds three pages; only one is on screen at a time. */
  page: RailPage;
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

const planningNodes: { layer: PlanningLayer; path: string; label: string }[] = [
  { layer: "A", path: BLUEPRINT_PATH, label: "全本蓝图" },
  { layer: "B", path: TOC_PATH, label: "目录" },
  { layer: "C", path: ARCS_PATH, label: "剧情弧" },
];

/** One 设定库 panel plus the documents that back it. `kind` matches the server's. */
type LibraryGroup = {
  kind: string;
  label: string;
  open: boolean;
  onOpen: () => void;
  /** Reader-facing file name; characters carry their own name, books keep the path. */
  fileName: (meta: FileMeta) => string;
  /** 批注 6: a leading mark so the row is not four characters floating in a
   *  wide empty margin. */
  icon: typeof Users;
};

const MENU_WIDTH = 232;

const PAGE_TITLES: Record<RailPage, string> = { plan: "规划", library: "设定库", chat: "对话" };

export default function TreePane({
  page,
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
  // 帧 27: search and the new/collapse actions are not furniture. The field only
  // exists once the reader asks for it.
  const [searchOpen, setSearchOpen] = useState(false);
  // 批注 5, 6: the second press is "put it back", not "open everything". What you
  // had open before folding is the state worth returning to.
  const preCollapse = useRef<Record<string, boolean> | null>(null);
  const [chapterQuery, setChapterQuery] = useState("");
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
  const bookName = (meta: FileMeta) => meta.path.split("/").pop() ?? meta.path;
  const LIBRARY_GROUPS: LibraryGroup[] = [
    {
      kind: "character",
      label: "人物",
      icon: Users,
      open: charactersOpen,
      onOpen: onOpenCharacters,
      // 帧 26 的写法：陈默 · 7.md。名字给人看，路径里的 id 才是主键。
      fileName: (meta) => `${meta.label.replace(" 档案", "")} · ${bookName(meta)}`,
    },
    {
      kind: "foreshadow",
      label: "伏笔",
      icon: Bookmark,
      open: foreshadowOpen,
      onOpen: onOpenForeshadow,
      fileName: bookName,
    },
    {
      kind: "worldview",
      label: "世界观",
      icon: Globe,
      open: worldMapOpen,
      onOpen: onOpenWorldMap,
      fileName: bookName,
    },
    {
      kind: "feedback",
      label: "反馈记录",
      icon: StickyNote,
      open: feedbackOpen,
      onOpen: onOpenFeedback,
      fileName: bookName,
    },
  ];

  const needle = chapterQuery.trim().toLowerCase();
  const filtering = needle.length > 0;
  const shownChapters = filtering
    ? chapters.filter(
        (chapter) =>
          String(chapter.chapter_number).includes(needle) ||
          (chapter.title || "").toLowerCase().includes(needle),
      )
    : chapters;
  // While a search is on, matched chapters open themselves: the point is to jump to
  // the file, not to make the reader expand each one after finding it.
  const isCollapsed = (key: string) => !filtering && collapsed[key] === true;

  const allCollapsed =
    collapsed.plan &&
    collapsed.library &&
    chapters.every((chapter) => collapsed[`chapter-${chapter.chapter_number}`]) &&
    LIBRARY_GROUPS.every((group) => collapsed[`lib-${group.kind}`]);
  const collapseLabel = allCollapsed ? "展开全部" : "折叠全部";

  return (
    <nav className="tree" data-page={page} aria-label="项目结构">
      <header className="tree-page-head">
        <h2 className="tree-page-title">{PAGE_TITLES[page]}</h2>
        <span className="tree-page-count tabular">
          {page === "plan"
            ? `${chapters.length} 章`
            : page === "library"
              ? `${settingFiles.length} 份`
              : "-"}
        </span>
        <div className="tree-page-actions">
          {page !== "chat" ? (
            <button
              type="button"
              className="icon-button"
              aria-label={searchOpen ? "关闭搜索" : "搜索"}
              title={searchOpen ? "关闭搜索" : "搜索"}
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              {searchOpen ? <X size={14} /> : <Search size={14} />}
            </button>
          ) : null}
          {page === "plan" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="新建章节"
              title={creatingChapter ? "正在新建" : "新建下一章简报（Ctrl+Alt+N）"}
              disabled={creatingChapter}
              onClick={onCreateChapter}
            >
              <Plus size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            title={preCollapse.current ? "恢复上一次的展开" : collapseLabel}
            aria-label={preCollapse.current ? "恢复上一次的展开" : collapseLabel}
            onClick={() => {
              if (preCollapse.current) {
                setCollapsed(preCollapse.current);
                preCollapse.current = null;
                return;
              }
              // Scoped to the page you are on: folding 规划 must not quietly fold the
              // 设定库 you cannot even see.
              const next: Record<string, boolean> = { ...collapsed };
              if (page === "plan") {
                chapters.forEach((chapter) => {
                  next[`chapter-${chapter.chapter_number}`] = true;
                });
              } else {
                LIBRARY_GROUPS.forEach((group) => {
                  next[`lib-${group.kind}`] = true;
                });
              }
              preCollapse.current = collapsed;
              setCollapsed(next);
            }}
          >
            {preCollapse.current ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button>
        </div>
      </header>
      {searchOpen && page !== "chat" ? (
        <label className="tree-search-row">
          <input
            className="tree-search"
            type="search"
            value={chapterQuery}
            placeholder={page === "plan" ? "章号 / 章名" : "设定名"}
            aria-label="搜索"
            onChange={(event) => setChapterQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setChapterQuery("");
                setSearchOpen(false);
              }
            }}
          />
        </label>
      ) : null}
      <button
        type="button"
        className="tree-root tree-root-plan"
        onClick={() => toggle("plan")}
        aria-expanded={!collapsed.plan}
      >
        {collapsed.plan ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        规划
      </button>
      {!collapsed.plan && (
        <div className="tree-children tree-section-plan">
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
            </div>
          ))}

          <div className="tree-divider">
            <span>章节</span>
            {/* 几百章时「翻」不是办法。这里沿用帧 21 已批准的搜索语言：输入即筛、
                匹配计数、Esc 清空、无结果给空态，而不是另发明一套交互。 */}
            {filtering ? (
              <span className="tree-count tabular">
                匹配 {shownChapters.length} / 共 {chapters.length} 章
              </span>
            ) : null}
          </div>
          <div className="tree-chapter-list">
          {shownChapters.map((chapter) => {
            const key = `chapter-${chapter.chapter_number}`;
            const brief = briefRows.find((row) => row.chapter === chapter.chapter_number);
            const selected =
              chapter.id === selectedChapterId ||
              activeFile === draftPath(chapter.chapter_number) ||
              activeFile === brief?.path;
            return (
              <div key={chapter.id} className="tree-group">
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
                    aria-expanded={!isCollapsed(key)}
                    onClick={() => toggle(key)}
                  >
                    {isCollapsed(key) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <button
                    type="button"
                    className="tree-label mono"
                    title={`打开第 ${chapter.chapter_number} 章正文页`}
                    onClick={() => onSelectChapter(chapter.id)}
                  >
                    {String(chapter.chapter_number).padStart(4, "0")}
                  </button>
                  <StatusBadge
                    status={chapter.status}
                    dot
                    scope={`第 ${chapter.chapter_number} 章`}
                  />
                </div>
                {!isCollapsed(key) && (
                  <>
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
                  </>
                )}
              </div>
            );
          })}
          </div>
          {chapters.length > 0 && shownChapters.length === 0 && (
            <p className="tree-empty">
              没有匹配「{chapterQuery.trim()}」的章节{" "}
              <button type="button" className="tree-inline-action" onClick={() => setChapterQuery("")}>
                清除搜索
              </button>
            </p>
          )}
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
        className="tree-root tree-root-library"
        onClick={() => toggle("library")}
        aria-expanded={!collapsed.library}
      >
        {collapsed.library ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        设定库
      </button>
      {!collapsed.library && (
        <div className="tree-children tree-section-library">
          {LIBRARY_GROUPS.map((group) => {
            const files = settingFiles.filter(
              (meta) =>
                meta.kind === group.kind &&
                (!needle ||
                  group.fileName(meta).toLowerCase().includes(needle) ||
                  meta.path.toLowerCase().includes(needle)),
            );
            return (
              <div className="tree-group" key={group.kind}>
                <div className={`tree-row ${group.open ? "selected" : ""}`}>
                  {files.length > 0 ? (
                    <button
                      type="button"
                      className="tree-prefix"
                      aria-label={`${group.label}的文件列表`}
                      aria-expanded={!collapsed[`lib-${group.kind}`]}
                      onClick={() => toggle(`lib-${group.kind}`)}
                    >
                      {collapsed[`lib-${group.kind}`] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : null}
                  <group.icon size={13} aria-hidden="true" className="tree-glyph" />
                  <button type="button" className="tree-label" onClick={group.onOpen}>
                    {group.label}
                  </button>
                  {files.length ? <span className="tree-hint">{files.length}</span> : null}
                </div>
                {/* 帧 26 A 区：面板入口保留，文档路径嵌在下面，与「人物 → 一人一个 md」同一规则。
                    路径只用 id，改名不换路径，同「章号是主键」。列表可折叠：几百个人物时
                    不能把整个设定库顶出屏幕。 */}
                {!collapsed[`lib-${group.kind}`] &&
                  files.map((meta) => (
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

      {/* The footer bar is gone (帧 27 批注 1): a row of framed buttons under a
          tree is the loudest possible way to say "you can add one". The same two
          actions are icons in the page header now, revealed with the pointer. */}
      {page === "chat" ? (
        /* 帧 27: the shell, not a mock. A conversation list needs a conversation
           table, which is S3 work - until then this says so rather than showing
           invented threads. */
        <p className="tree-empty">
          还没有会话记录。中栏的对话目前按章保存，要在这里列出来，得先有会话表那一层。
        </p>
      ) : null}
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
