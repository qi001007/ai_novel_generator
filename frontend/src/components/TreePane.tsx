import { useEffect, useRef, useState } from "react";
import { uiZoom } from "../store/appearance";
import { useMenuPlacement } from "../menuPlacement";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Globe,
  Info,
  Plus,
  Search,
  StickyNote,
  Users,
  X,
} from "lucide-react";
import type { RailPage } from "./ActivityRail";

import { api } from "../api";
import { Button, FloatingWindow, IconButton, useToast } from "./ui";
import StatusBadge from "./StatusBadge";
import type { ChatConversation, Chapter, ContextWorkflow, FileMeta } from "../types";
import {
  ARCS_PATH,
  BLUEPRINT_PATH,
  chapterMatches,
  chapterListLabel,
  draftBody,
  draftPath,
  TOC_PATH,
  useFiles,
} from "../store/files";
import { useWorkbench } from "../store/workbench";

export type PlanningLayer = "A" | "B" | "C";

/** One brief file in the tree; `exists` is false for the next chapter's slot. */
export type BriefRow = { path: string; chapter: number; hint: string; exists: boolean };

/** What the pointer was on when the context menu opened. */
type MenuTarget =
  | { kind: "group" }
  | { kind: "file"; path: string }
  | { kind: "workflow"; id: number; isDefault: boolean; purpose: ContextWorkflow["purpose"] };

type MenuState = { x: number; y: number; target: MenuTarget } | null;

type KnowledgeDraft = {
  id: number;
  kind: string;
  name: string;
  content: string;
  status: string;
  revision: number;
};

type SettingSearchResult = {
  source: string;
  label: string;
  path: string;
  snippet: string;
  status: string;
};

const KNOWLEDGE_LABELS: Record<string, string> = {
  character: "人物",
  world: "世界观",
  worldview: "世界观",
  foreshadow: "伏笔",
  location: "地点",
  organisation: "组织",
  research: "研究",
};

type TreePaneProps = {
  /** 帧 27: the sidebar holds three pages; only one is on screen at a time. */
  page: RailPage;
  novelId: number | null;
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
  /** 「新建对话」：当前线程收尾，开一条新的；旧的留着不删（第二十八批批注 8）。 */
  onNewConversation: () => void;
  /** 历史对话（= 线程），最新在前（第二十九批批注 6）。 */
  conversations: ChatConversation[];
  /** 中栏现在看的那条线程；null 表示「后端意义上的当前线程」。 */
  activeConversation: number | null;
  onSelectConversation: (conversationId: number) => void;
  onOpenConversationDetail: (conversationId: number) => void;
  /** 改章名（序号不动，第二十八批批注 6）：弹窗在工作台那边，这里只报章号。 */
  onRenameChapter: (chapterNumber: number) => void;
  /** 在其后插入一章：后面的序号自动 +1，章名跟着章走。 */
  onInsertChapterAfter: (chapterNumber: number) => void;
  /** 导出是读。树这边只负责把「章号 + 格式」交给上层，不碰 API。 */
  onExport: (chapterNumber: number, format: "txt" | "md") => void;
  /** 导出这份文档本身（投影出来的那份文本），第二十五批批注 4。 */
  onExportDocument: (path: string) => void;
  /** 删一章（第二十六批批注 6）：确认弹窗在工作台那边，这里只报章号。 */
  onDeleteChapter: (chapterNumber: number) => void;
  /** 「重新编号」：把 1、2、4、5 这种空洞压成 1..N（第二十九批批注 5）。 */
  onRenumber: () => void;
  /** 已经有空洞才允许按；连续时这条 disabled 并写明原因。 */
  renumberNeeded: boolean;
  exportError: string | null;
  onOpenCharacters: () => void;
  onOpenWorkflow: () => void;
  onOpenFeedback: () => void;
  onOpenWorldview: () => void;
  onOpenForeshadow: () => void;
  worldviewOpen: boolean;
  foreshadowOpen: boolean;
};

const planningNodes: { layer: PlanningLayer; path: string; label: string }[] = [
  { layer: "A", path: BLUEPRINT_PATH, label: "全书蓝图" },
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

const PAGE_TITLES: Record<RailPage, string> = {
  plan: "文章结构",
  library: "设定库",
  map: "地图库",
  workflow: "Workflow",
  chat: "对话记录",
};

const MODULE_HINTS: Partial<Record<RailPage, string>> = {
  map: "地图工程、图块与扩图任务在右侧管理",
};

export default function TreePane({
  page,
  novelId,
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
  onNewConversation,
  conversations,
  activeConversation,
  onSelectConversation,
  onOpenConversationDetail,
  onRenameChapter,
  onInsertChapterAfter,
  onExport,
  onExportDocument,
  onDeleteChapter,
  onRenumber,
  renumberNeeded,
  exportError,
  onOpenCharacters,
  onOpenWorkflow,
  onOpenFeedback,
  onOpenWorldview,
  onOpenForeshadow,
  worldviewOpen,
  foreshadowOpen,
}: TreePaneProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedWorkflowGroups, setCollapsedWorkflowGroups] = useState<Record<string, boolean>>({});
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeDraft[]>([]);
  const [knowledgeEpoch, setKnowledgeEpoch] = useState(0);
  const [selectedDraft, setSelectedDraft] = useState<KnowledgeDraft | null>(null);
  const [settingResults, setSettingResults] = useState<SettingSearchResult[]>([]);
  const [searchWindowOpen, setSearchWindowOpen] = useState(false);
  const [selectedSearch, setSelectedSearch] = useState<SettingSearchResult | null>(null);
  // 第十四批批注 6: the tree has to say what the tab says. Subscribe to the buffers
  // themselves - `isChapterDirty` is a stable function and would never re-render.
  // 批注 3.3: the buffer is the draft.md file entry, so the tree, the chapter tab
  // and the file tab all read the same dirty flag instead of three copies of it.
  const draftEntries = useFiles((state) => state.entries);
  const dirtyChapter = (chapter: Chapter) => {
    const entry = draftEntries[draftPath(chapter.chapter_number)];
    if (!entry?.doc) return false;
    return draftBody(entry.draft, chapter.chapter_number) !== draftBody(entry.doc.text, chapter.chapter_number);
  };
  // 帧 27: search and the new/collapse actions are not furniture. The field only
  // exists once the reader asks for it.
  const [searchOpen, setSearchOpen] = useState(false);
  // 批注 5, 6: the second press is "put it back", not "open everything". What you
  // had open before folding is the state worth returning to.
  const [chapterQuery, setChapterQuery] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);
  const [workflows, setWorkflows] = useState<ContextWorkflow[]>([]);
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const [ensuringWorkflowDefaults, setEnsuringWorkflowDefaults] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedWorkflowId = useWorkbench((state) => state.selectedWorkflowId);
  const workflowRefreshEpoch = useWorkbench((state) => state.workflowRefreshEpoch);
  const selectWorkflow = useWorkbench((state) => state.selectWorkflow);
  const requestNewWorkflow = useWorkbench((state) => state.requestNewWorkflow);
  const requestWorkflowCommand = useWorkbench((state) => state.requestWorkflowCommand);
  const refreshWorkflowList = useWorkbench((state) => state.refreshWorkflowList);
  const { pushToast } = useToast();

  useEffect(() => {
    if (page !== "workflow") return;
    let active = true;
    setWorkflowsLoaded(false);
    api.listWorkflows(novelId).then((items) => {
      if (!active) return;
      setWorkflows(items);
      setWorkflowsLoaded(true);
      const current = items.some((item) => item.id === selectedWorkflowId)
        ? selectedWorkflowId
        : (items.find((item) => item.is_default) ?? items[0])?.id ?? null;
      if (current !== null && current !== selectedWorkflowId) selectWorkflow(current);
    }).catch(() => {
      if (active) setWorkflows([]);
    });
    return () => { active = false; };
  }, [novelId, page, selectWorkflow, selectedWorkflowId, workflowRefreshEpoch]);

  async function ensureDefaultWorkflows() {
    if (novelId === null || ensuringWorkflowDefaults) return;
    setEnsuringWorkflowDefaults(true);
    try {
      const operation = await api.executeCommand<{
        created_workflow_ids: number[];
        missing_model_purposes: string[];
      }>(
        "workflow.ensure_defaults",
        { novel_id: novelId },
        `workflow-ensure-defaults:${novelId}:${crypto.randomUUID()}`,
      );
      refreshWorkflowList();
      if (operation.result.missing_model_purposes.length > 0) {
        pushToast("已补齐系统工作流草稿；未配置模型的用途暂不可发布", "info");
      } else if (operation.result.created_workflow_ids.length > 0) {
        pushToast("系统工作流已补齐", "success");
      } else {
        pushToast("工作流列表已更新", "success");
      }
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : "补齐系统工作流失败", "error");
    } finally {
      setEnsuringWorkflowDefaults(false);
    }
  }

  useEffect(() => {
    if (page !== "library" || !novelId) {
      setKnowledgeEntries([]);
      return;
    }
    let active = true;
    api.get<KnowledgeDraft[]>(`/api/novels/${novelId}/knowledge`)
      .then((items) => {
        if (active) setKnowledgeEntries(items.filter((item) => item.status !== "retired"));
      })
      .catch(() => { if (active) setKnowledgeEntries([]); });
    return () => { active = false; };
  }, [novelId, page, knowledgeEpoch]);

  useEffect(() => {
    const query = chapterQuery.trim();
    if (page !== "library" || !novelId || !query) {
      setSettingResults([]);
      setSearchWindowOpen(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api.get<SettingSearchResult[]>(`/api/novels/${novelId}/settings-search?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          if (!active) return;
          setSettingResults(rows);
          setSearchWindowOpen(true);
        })
        .catch(() => {
          if (!active) return;
          setSettingResults([]);
          setSearchWindowOpen(true);
        });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [novelId, page, chapterQuery]);

  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const fileSelected = (path: string) => activeFile === path;
  const knowledgeDrafts = knowledgeEntries.filter((item) => item.status === "draft");

  async function approveDraft(entry: KnowledgeDraft) {
    try {
      const operation = await api.post<{ result?: { merged_into?: string } }>("/api/commands/knowledge.approve/execute", {
        payload: { knowledge_id: entry.id, base_revision: entry.revision },
        idempotency_key: `approve-knowledge-${entry.id}-${Date.now()}`,
      });
      void useFiles.getState().refreshMetas();
      useWorkbench.setState({
        notice: operation.result?.merged_into
          ? `已合并进 ${operation.result.merged_into}`
          : "设定已批准",
      });
      setSelectedDraft(null);
      setKnowledgeEpoch((value) => value + 1);
    } catch (cause) {
      useWorkbench.setState({ error: cause instanceof Error ? cause.message : "批准设定失败" });
    }
  }

  async function retireDraft(entry: KnowledgeDraft) {
    if (!window.confirm(`删除这条设定草稿？\n${entry.name}`)) return;
    try {
      await api.post("/api/commands/asset.delete/execute", {
        payload: {
          asset_type: "knowledge",
          asset_id: entry.id,
          base_revision: entry.revision,
        },
        idempotency_key: `retire-knowledge-${entry.id}-${Date.now()}`,
        approved: true,
      });
      setSelectedDraft(null);
      setKnowledgeEpoch((value) => value + 1);
    } catch (cause) {
      useWorkbench.setState({ error: cause instanceof Error ? cause.message : "删除设定失败" });
    }
  }

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
    // 只记点击点（视觉像素）。方位交给 useMenuPlacement：它量得到菜单**这一回**有多高，
    // 而以前这里只夹 x、y 完全不管 - 底部右键就被裁掉（第二十六批批注 5）。
    setMenu({ x: event.clientX, y: event.clientY, target });
  };

  const runMenuAction = (action: () => void) => () => {
    setMenu(null);
    action();
  };

  const menuPath = menu?.target.kind === "file" ? menu.target.path : null;
  const menuWorkflow = menu?.target.kind === "workflow" ? menu.target : null;
  // 方位由实测高度决定（两处菜单共用同一份算法，见 menuPlacement.ts）
  const placement = useMenuPlacement(menuRef, menu, MENU_WIDTH);
  /* 章节行与它的 draft.md 右键指向同一个目标（路径就是 draft.md），
     所以主人要的「每一个章节的右键」和「每一个 draft.md 的右键」
     在这里是同一扇门，brief.md 不给导出。 */
  const menuChapterFile = menuPath ? /^chapters\/(\d{4})\/draft\.md$/.exec(menuPath) : null;
  const menuChapter = menuChapterFile ? Number(menuChapterFile[1]) : null;
  // 章节的任一份文件（draft.md 与 brief.md）都指同一章 - 删除是对「这一章」做的，
  // 不该因为右键的是哪一片叶子而时有时无
  const menuAnyChapter = menuPath ? /^chapters\/(\d{4})\//.exec(menuPath) : null;
  const menuChapterTarget = menuAnyChapter ? Number(menuAnyChapter[1]) : null;
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
      open: worldviewOpen,
      onOpen: onOpenWorldview,
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
  // Match what is on screen, not the field behind it. `chapter_number` is a number, so
  // the old String(1) = "1" could never answer "0", "00" or "0001" even though the row
  // reads 0001 - the owner's words: 「你必须得搜123才能搜到，你这个就不太对」.
  const shownChapters = filtering ? chapters.filter((chapter) => chapterMatches(chapter, needle)) : chapters;
  // While a search is on, matched chapters open themselves: the point is to jump to
  // the file, not to make the reader expand each one after finding it.
  const isCollapsed = (key: string) => !filtering && collapsed[key] === true;

  /* 标签必须与状态一致（第二十五批批注 2 的另一半）。以前这里要求 plan + library +
     每一章 + 每一组**全部**折叠才改口叫「展开全部」，于是部分折叠时点它只会折得更多 -
     「折叠之后打不开」因此有第二条路。现在只要有任何东西是折叠的，这枚钮就写「展开全部」，
     点一下全展开；全展开时才写「折叠全部」。 */
  const anyCollapsed = Object.values(collapsed).some(Boolean);
  const collapseLabel = anyCollapsed ? "展开全部" : "折叠全部";

  return (
    <nav className="tree" data-page={page} aria-label="项目结构">
      <header className="tree-page-head">
        <h2 className="tree-page-title">{PAGE_TITLES[page]}</h2>
        <div className="tree-page-actions">
          {page === "plan" || page === "library" ? (
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
          {page === "chat" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="新建对话"
              title="新建对话"
              onClick={onNewConversation}
            >
              <Plus size={14} />
            </button>
          ) : null}
          {page === "workflow" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="新建工作流"
              title="新建工作流"
              onClick={requestNewWorkflow}
            >
              <Plus size={14} />
            </button>
          ) : null}
          {(page === "plan" || page === "library") ? <button
            type="button"
            className="icon-button"
            title={collapseLabel}
            aria-label={collapseLabel}
            onClick={() => {
              if (anyCollapsed) {
                setCollapsed({});
                return;
              }
              // Scoped to the page you are on: folding 规划 must not quietly fold the
              // 设定库 you cannot even see.
              const next: Record<string, boolean> = {};
              if (page === "plan") {
                chapters.forEach((chapter) => {
                  next[`chapter-${chapter.chapter_number}`] = true;
                });
              } else {
                LIBRARY_GROUPS.forEach((group) => {
                  next[`lib-${group.kind}`] = true;
                });
              }
              setCollapsed(next);
            }}
          >
            {anyCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button> : null}
        </div>
      </header>
      {searchOpen && (page === "plan" || page === "library") ? (
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
      {MODULE_HINTS[page] ? <p className="tree-module-hint">{MODULE_HINTS[page]}</p> : null}
      {page === "workflow" ? (
        <div className="tree-children tree-section-workflows" aria-label="工作流列表">
          {(["generation", "review"] as const).map((purpose) => {
            const groupCollapsed = Boolean(collapsedWorkflowGroups[purpose]);
            return <section className="workflow-tree-group" key={purpose}>
              <button
                type="button"
                className="tree-root"
                aria-expanded={!groupCollapsed}
                onClick={() => setCollapsedWorkflowGroups((current) => ({ ...current, [purpose]: !groupCollapsed }))}
              >
                {groupCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {purpose === "generation" ? "正文生成" : "AI 自检"}
              </button>
              {groupCollapsed ? null : <div className="tree-children">
                {workflows.filter((workflow) => workflow.purpose === purpose).map((workflow) => (
                  <button
                    type="button"
                    key={workflow.id}
                    className={`tree-row workflow-resource ${workflow.id === selectedWorkflowId ? "selected" : ""}`}
                    title={workflow.name}
                    onClick={() => {
                      selectWorkflow(workflow.id);
                      onOpenWorkflow();
                    }}
                    onContextMenu={(event) => openMenu(event, { kind: "workflow", id: workflow.id, isDefault: workflow.is_default, purpose })}
                  >
                    <span className="tree-label">{workflow.name}</span>
                    {workflow.is_default ? (
                      <span className="tree-hint">
                        {workflow.published_version
                          ? `当前 · v${workflow.published_version}`
                          : "当前 · 未发布"}
                      </span>
                    ) : null}
                  </button>
                ))}
                {workflows.every((workflow) => workflow.purpose !== purpose) ? <p className="tree-empty">暂无</p> : null}
              </div>}
            </section>;
          })}
          {workflows.length === 0 ? <p className="tree-empty">暂无工作流</p> : null}
          {workflowsLoaded && novelId !== null && (["generation", "review"] as const).some(
            (purpose) => workflows.every((workflow) => workflow.novel_id !== novelId || workflow.purpose !== purpose),
          ) ? (
            <Button compact loading={ensuringWorkflowDefaults} onClick={ensureDefaultWorkflows}>
              补齐系统工作流
            </Button>
          ) : null}
        </div>
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
                    title={`打开 ${chapterListLabel(chapter)}`}
                    onClick={() => onSelectChapter(chapter.id)}
                  >
                    {chapterListLabel(chapter)}
                  </button>
                  {/* One dot, one fact: unsaved outranks status, because that is the
                      thing the tab already shouts about and the two must agree. */}
                  {dirtyChapter(chapter) ? (
                    <i
                      className="dirty-dot"
                      aria-label={`第 ${chapter.chapter_number} 章 未保存`}
                      title="未保存"
                    />
                  ) : (
                    <StatusBadge
                      status={chapter.status}
                      dot
                      scope={`第 ${chapter.chapter_number} 章`}
                    />
                  )}
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
                      /* 第二十四批：这两片叶子以前只有 onClick，右键什么都不出来 -
                         主人要的「每一个 draft.md 也要有右键导出」就落在这里。目标
                         和章节行是同一个 draft 路径，菜单因此天然带导出两行。 */
                      onContextMenu={(event) =>
                        openMenu(event, { kind: "file", path: draftPath(chapter.chapter_number) })
                      }
                    >
                      draft.md
                    </button>
                    <button
                      type="button"
                      className={`tree-row file ${activeFile === brief?.path ? "selected" : ""}`}
                      disabled={!brief}
                      title={brief ? undefined : "先写入简报后出现"}
                      onClick={() => brief && onOpenFile(brief.path)}
                      onContextMenu={(event) =>
                        brief && openMenu(event, { kind: "file", path: brief.path })
                      }
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
                    {knowledgeDrafts.length ? (
            <div className="tree-group">
              <div className="tree-row">
                <button
                  type="button"
                  className="tree-prefix"
                  aria-label="待确认设定的列表"
                  aria-expanded={!collapsed["knowledge-drafts"]}
                  onClick={() => toggle("knowledge-drafts")}
                >
                  {collapsed["knowledge-drafts"] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
                <StickyNote size={13} aria-hidden="true" className="tree-glyph" />
                <span className="tree-label">待确认设定</span>
                <span className="tree-hint">{knowledgeDrafts.length}</span>
              </div>
              {!collapsed["knowledge-drafts"] && knowledgeDrafts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="tree-row file"
                  title={item.content}
                  onClick={() => setSelectedDraft(item)}
                >
                  {KNOWLEDGE_LABELS[item.kind] ?? item.kind} · {item.name}
                </button>
              ))}
            </div>
          ) : null}
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
                {!collapsed[`lib-${group.kind}`] && (
                  <>
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
                    </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* The footer bar is gone (帧 27 批注 1): a row of framed buttons under a
          tree is the loudest possible way to say "you can add one". The same two
          actions are icons in the page header now, revealed with the pointer. */}
      {page === "chat" ? (
        /* 第二十九批批注 6：这一页以前只挂着一句「得先有会话表那一层」，而 28.8 之后
           线程号早就是真的了 - 缺的从来不是表，是把它们查出来的那一句。
           一条都没有时一行都不多写（28.3 同一条纪律）。 */
        <div className="tree-children tree-section-conversations">
          {conversations.map((item) => {
            const active =
              activeConversation === null ? item.is_current : activeConversation === item.conversation_id;
            return (
              <div
                key={item.conversation_id}
                className={`tree-row conversation ${active ? "selected" : ""}`}
                title={`${item.first_question} · ${item.message_count} 条`}
              >
                <button type="button" className="tree-label" onClick={() => onSelectConversation(item.conversation_id)}>
                  {item.first_question}
                </button>
                <span className="tree-hint">{item.message_count}</span>
                <IconButton type="button" aria-label="对话详情" title="对话详情" onClick={() => onOpenConversationDetail(item.conversation_id)}>
                  <Info size={12} />
                </IconButton>
              </div>
            );
          })}
        </div>
      ) : null}
      {createError && <p className="tree-action-error">{createError}</p>}
      {exportError && <p className="tree-action-error">{exportError}</p>}

      {menu && (
        <div
          ref={menuRef}
          className="tree-menu"
          role="menu"
          style={{
            left: placement?.left ?? menu.x / uiZoom(),
            top: placement?.top ?? menu.y / uiZoom(),
            width: MENU_WIDTH,
            maxHeight: placement?.maxHeight,
          }}
        >
          {menuWorkflow ? <>
            <button type="button" role="menuitem" className="tree-menu-item" onClick={runMenuAction(() => {
              selectWorkflow(menuWorkflow.id);
              onOpenWorkflow();
            })}><span>打开</span></button>
            <button
              type="button"
              role="menuitem"
              className="tree-menu-item"
              onClick={runMenuAction(() => requestWorkflowCommand("rename", menuWorkflow.id))}
            >
              <span>重命名</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="tree-menu-item"
              disabled={menuWorkflow.isDefault}
              onClick={runMenuAction(() => requestWorkflowCommand("default", menuWorkflow.id))}
            >
              <span>{menuWorkflow.isDefault ? "当前流程" : `设为当前${menuWorkflow.purpose === "generation" ? "正文生成" : "AI 自检"}`}</span>
            </button>
            <button type="button" role="menuitem" className="tree-menu-item" onClick={runMenuAction(() => requestWorkflowCommand("duplicate", menuWorkflow.id))}><span>复制</span></button>
            <div className="tree-menu-sep" />
            <button type="button" role="menuitem" className="tree-menu-item danger" onClick={runMenuAction(() => requestWorkflowCommand("delete", menuWorkflow.id))}><span>删除</span></button>
          </> : <>
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
          {menuChapter !== null ? (
            <>
              <div className="tree-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item"
                onClick={runMenuAction(() => onExport(menuChapter, "txt"))}
              >
                <span>导出本章…</span>
                <kbd>纯文本</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item"
                onClick={runMenuAction(() => onExport(menuChapter, "md"))}
              >
                <span>导出本章 Markdown</span>
                <kbd>.md</kbd>
              </button>
            </>
          ) : null}
          {menuPath && menuChapter === null ? (
            /* 正文那份文件已经有「导出本章」两行了 - 再来一行同名不同义的
               「导出为 Markdown」只会让人猜哪条才是他要的。其余每一份文档
               （蓝图 / 目录 / 剧情弧 / 简报 / 设定库）都补这一行。 */
            <>
              <div className="tree-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item"
                onClick={runMenuAction(() => onExportDocument(menuPath))}
              >
                <span>导出为 Markdown</span>
                <kbd>.md</kbd>
              </button>
            </>
          ) : null}
          <div className="tree-menu-sep" />
          {/* 第二十三批批注 2：这一条和第一项是同一件事的重叠占位，删掉。
              「未开放」的理由（章号顺延牵动文件名/目录锚点/弧范围）已经挂在
              下面那条「重命名 / 删除」上，不需要再占一行。 */}
          {menuChapterTarget !== null ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item"
                onClick={runMenuAction(() => onRenameChapter(menuChapterTarget))}
              >
                <span>重命名</span>
                <kbd>只改名字</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item"
                disabled={creatingChapter}
                onClick={runMenuAction(() => onInsertChapterAfter(menuChapterTarget))}
              >
                <span>在其后插入一章</span>
                <kbd>后面 +1</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item danger"
                onClick={runMenuAction(() => onDeleteChapter(menuChapterTarget))}
              >
                <span>删除章节</span>
                <kbd>后面 -1</kbd>
              </button>
              <div className="tree-menu-sep" />
              {/* 第二十九批批注 5：1、2、4、5 这种空洞一旦留下，之后怎么插都差一格。
                  他给的办法是一个刷新键。连续时不隐藏而是 disabled + 写明原因 -
                  §0.7 条八要两条可达路径，所以它同时挂在 Ctrl+Alt+R 上。 */}
              <button
                type="button"
                role="menuitem"
                className="tree-menu-item"
                disabled={!renumberNeeded}
                title={renumberNeeded ? undefined : "章号已经是连续的"}
                onClick={runMenuAction(onRenumber)}
              >
                <span>重新编号</span>
                <kbd>Ctrl+Alt+R</kbd>
              </button>
            </>
          ) : null}
          </>}
        </div>
      )}
      {searchWindowOpen && filtering ? (
        <FloatingWindow
          title={`搜索设定 · ${chapterQuery.trim()}`}
          onClose={() => setSearchWindowOpen(false)}
          width={460}
          height={420}
          minWidth={320}
          minHeight={220}
        >
          <div className="setting-search-list">
            {settingResults.length ? settingResults.map((result, index) => (
              <button
                key={`${result.source}:${result.label}:${index}`}
                type="button"
                className="setting-search-row"
                onClick={() => {
                  setSearchWindowOpen(false);
                  if (result.path) onOpenFile(result.path);
                  else setSelectedSearch(result);
                }}
              >
                <strong>{result.label}</strong>
                <span>{result.snippet}</span>
              </button>
            )) : <p className="review-save-note">没有匹配的设定</p>}
          </div>
        </FloatingWindow>
      ) : null}
      {selectedSearch ? (
        <FloatingWindow
          title="设定搜索"
          onClose={() => setSelectedSearch(null)}
          width={420}
          height={320}
          minWidth={300}
          minHeight={200}
        >
          <div className="review-suggestion-panel">
            <span className="review-drawer-kicker">
              {selectedSearch.source}
              {selectedSearch.status ? ` · ${selectedSearch.status}` : ""}
            </span>
            <strong>{selectedSearch.label}</strong>
            <p>{selectedSearch.snippet}</p>
          </div>
        </FloatingWindow>
      ) : null}
      {selectedDraft ? (
        <FloatingWindow
          title="待确认设定"
          onClose={() => setSelectedDraft(null)}
          width={420}
          height={360}
          minWidth={300}
          minHeight={220}
        >
          <div className="review-suggestion-panel">
            <span className="review-drawer-kicker">
              {KNOWLEDGE_LABELS[selectedDraft.kind] ?? selectedDraft.kind}
            </span>
            <strong>{selectedDraft.name}</strong>
            <p>{selectedDraft.content}</p>
            <p className="review-save-note">
              {selectedDraft.status === "draft"
                ? "AI 质检生成的草稿，尚未批准进入稳定上下文"
                : "已确认，可进入稳定上下文"}
            </p>
            <div className="review-drawer-actions">
              {selectedDraft.status === "draft" ? (
                <Button compact tone="primary" onClick={() => void approveDraft(selectedDraft)}>批准</Button>
              ) : null}
              <Button compact tone="danger" onClick={() => void retireDraft(selectedDraft)}>删除</Button>
            </div>
          </div>
        </FloatingWindow>
      ) : null}
    </nav>
  );
}
