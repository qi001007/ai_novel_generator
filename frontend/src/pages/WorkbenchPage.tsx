import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Moon, Settings, Sun } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import CharacterLibrary from "../components/CharacterLibrary";
import ChatPane from "../components/ChatPane";
import EditorPane from "../components/EditorPane";
import FeedbackPanel from "../components/FeedbackPanel";
import FileEditorPane from "../components/FileEditorPane";
import ForeshadowWall from "../components/ForeshadowWall";
import SettingsPanel from "../components/SettingsPanel";
import Splitter, { type PaneKey } from "../components/Splitter";
import TreePane, { type BriefRow } from "../components/TreePane";
import WorldMapPanel from "../components/WorldMapPanel";
import { briefChapter, briefPath, useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";

type RightView = "editor" | "files" | "feedback" | "settings" | "worldmap" | "foreshadow";

type Panes = { sidebar: number; chat: number };

// Defaults follow UI-DESIGN.md and the approved frames: 280 / 470 / rest.
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 280;
const CHAT_MIN = 400;
const CHAT_DEFAULT_RATIO = 0.327; // 470 / 1440
const PANE_STORAGE_KEY = "workbench.panes";

function chatMax() {
  return Math.max(CHAT_MIN, window.innerWidth - 560);
}

function chatDefault() {
  return clampPane("chat", Math.round(window.innerWidth * CHAT_DEFAULT_RATIO));
}

function clampPane(pane: PaneKey, value: number) {
  const min = pane === "sidebar" ? SIDEBAR_MIN : CHAT_MIN;
  const max = pane === "sidebar" ? SIDEBAR_MAX : chatMax();
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultPanes(): Panes {
  return { sidebar: SIDEBAR_DEFAULT, chat: chatDefault() };
}

function loadPanes(): Panes {
  const base = defaultPanes();
  try {
    const raw = localStorage.getItem(PANE_STORAGE_KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<Panes>;
    // Re-clamp so a width saved on a wide monitor cannot overflow a narrow window.
    return {
      sidebar: clampPane("sidebar", stored.sidebar ?? base.sidebar),
      chat: clampPane("chat", stored.chat ?? base.chat),
    };
  } catch {
    return base;
  }
}

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const { novelId: novelIdParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const chapterIdParam = searchParams.get("chapter");
  const state = useWorkbench();
  const [rightView, setRightView] = useState<RightView>("editor");
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [panes, setPanes] = useState<Panes>(loadPanes);

  const metas = useFiles((store) => store.metas);
  const activeFile = useFiles((store) => store.active);
  const revealSeq = useFiles((store) => store.revealSeq);
  const attachFiles = useFiles((store) => store.attach);
  const openFile = useFiles((store) => store.open);
  const refreshMetas = useFiles((store) => store.refreshMetas);

  // All three entries land here, so they cannot drift apart.
  async function handleCreateChapter() {
    const created = await state.createNextChapter();
    if (created === null) return;
    await refreshMetas();
    setCharactersOpen(false);
    setRightView("files");
    void openFile(briefPath(created));
  }

  const createChapter = useRef(handleCreateChapter);
  createChapter.current = handleCreateChapter;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.altKey && (event.code === "KeyN" || key === "n")) {
        event.preventDefault();
        void createChapter.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(panes));
  }, [panes]);

  const sidebarWidth = clampPane("sidebar", panes.sidebar);
  const chatWidth = charactersOpen ? 0 : clampPane("chat", panes.chat);
  const columns = charactersOpen
    ? `${sidebarWidth}px 1px minmax(0, 1fr)`
    : `${sidebarWidth}px 1px ${chatWidth}px 1px minmax(0, 1fr)`;

  function writePane(pane: PaneKey, width: number) {
    setPanes((prev) => ({
      ...prev,
      sidebar: pane === "sidebar" ? width : prev.sidebar,
      chat: pane === "chat" ? width : prev.chat,
    }));
  }

  function beginDrag(pane: PaneKey, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = pane === "sidebar" ? panes.sidebar : panes.chat;

    function onMove(moveEvent: PointerEvent) {
      writePane(pane, clampPane(pane, startWidth + moveEvent.clientX - startX));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing");
    }

    document.body.classList.add("resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function nudge(pane: PaneKey, delta: number) {
    const current = pane === "sidebar" ? panes.sidebar : panes.chat;
    writePane(pane, clampPane(pane, current + delta));
  }

  function resetPane(pane: PaneKey) {
    writePane(pane, pane === "sidebar" ? SIDEBAR_DEFAULT : chatDefault());
  }

  useEffect(() => {
    const novelId = Number(novelIdParam);
    if (Number.isFinite(novelId) && novelId !== state.selectedNovelId) {
      state.selectNovel(novelId);
    }
  }, [novelIdParam, state.selectedNovelId]);

  // Deep links from run detail return with ?chapter=N. The view is restored
  // whether or not the chapter was already selected: it usually was, because
  // the store outlives this route, and skipping the view for that case is
  // exactly what landed the author on a file instead of on the prose.
  useEffect(() => {
    const chapterId = Number(chapterIdParam);
    if (!chapterIdParam || !Number.isFinite(chapterId)) return;
    if (!state.chapters.some((item) => item.id === chapterId)) return;
    if (chapterId !== state.selectedChapterId) state.selectChapter(chapterId);
    setRightView("editor");
    setSearchParams({}, { replace: true });
  }, [chapterIdParam, state.chapters, state.selectedChapterId, setSearchParams]);

  useEffect(() => {
    state.loadChapterRecords();
    // chapters is a dependency because the store now refuses to fetch records for a
    // chapter it cannot place in the selected novel; without it, a load that arrived
    // before the chapter list would never be retried.
  }, [state.selectedNovelId, state.selectedChapterId, state.recordVersion, state.chapters]);

  useEffect(() => {
    if (state.selectedNovelId) void attachFiles(state.selectedNovelId);
  }, [state.selectedNovelId, attachFiles]);

  // ?file=toc.md deep-links a planning file, so a document can be shared or
  // reopened directly. attach() above has already stamped novelId synchronously.
  const deepLink = searchParams.get("file");
  useEffect(() => {
    if (!deepLink || !state.selectedNovelId) return;
    void openFile(deepLink);
  }, [deepLink, state.selectedNovelId, openFile]);

  const chapter = state.chapters.find((item) => item.id === state.selectedChapterId) ?? null;

  /* This effect used to push the chapter record into the draft buffer on every
     selection, which is what silently discarded unsaved text when the reader
     clicked another chapter - and a chapter tab strip makes that the normal way
     to move around. The store now owns one buffer per chapter and hydrates it in
     selectChapter, so nothing has to sync here. */

  // The store decides when a file deserves the stage (tree click, AI proposal,
  // and the B→D jump all route through open()). revealSeq survives this route,
  // so a fresh mount must only react to a change it caused, never to the value
  // it inherited. A boolean "mounted" flag is not enough: StrictMode runs every
  // effect twice on mount, so the flag is already true on the second pass and
  // the stale value is mistaken for a click anyway. Comparing against the value
  // captured at first render is the version that holds in both passes.
  const lastReveal = useRef(revealSeq);
  useEffect(() => {
    const previous = lastReveal.current;
    lastReveal.current = revealSeq;
    if (previous === revealSeq || !revealSeq) return;
    setCharactersOpen(false);
    setRightView("files");
  }, [revealSeq]);

  // Brief rows: every file the server knows about, plus one empty slot for the
  // chapter after the last, which the backend happily creates on first write.
  const briefRows = useMemo<BriefRow[]>(() => {
    const rows = new Map<number, BriefRow>();
    metas
      .filter((meta) => meta.kind === "brief")
      .map((meta) => ({
        path: meta.path,
        chapter: briefChapter(meta.path) ?? 0,
        hint: `第 ${briefChapter(meta.path)} 章`,
        exists: true,
      }))
      .forEach((row) => {
        if (row.chapter > 0) rows.set(row.chapter, row);
      });
    // Chapter rows and briefs are created atomically, so an existing chapter is
    // enough to make its brief reachable even if a metadata refresh was stale.
    state.chapters.forEach((item) => {
      const chapter = item.chapter_number;
      if (!rows.has(chapter)) {
        rows.set(chapter, {
          path: briefPath(chapter),
          chapter,
          hint: `第 ${chapter} 章`,
          exists: true,
        });
      }
    });
    // The next slot follows the highest thing we know about: a chapter, or a
    // brief that exists without its prose yet.
    const last = state.chapters.reduce(
      (max, item) => Math.max(max, item.chapter_number),
      [...rows.values()].reduce((max, row) => Math.max(max, row.chapter), chapter?.chapter_number ?? 0),
    );
    const next = last + 1;
    if (last && !rows.has(next)) {
      rows.set(next, { path: briefPath(next), chapter: next, hint: "未建", exists: false });
    }
    return [...rows.values()].sort((a, b) => a.chapter - b.chapter);
  }, [metas, state.chapters, chapter?.chapter_number]);

  const novel = state.novels.find((item) => item.id === state.selectedNovelId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="icon-button" aria-label="返回书架" onClick={() => navigate("/")}>
            <ArrowLeft size={16} />
          </button>
          <strong className="topbar-title">{novel?.title ?? "未选择作品"}</strong>
        </div>
        <div className="topbar-right">
          {/* 批注 19: health moved up to where a reader already looks for it, and
              it only speaks when the pointer asks. */}
          <span
            className={`health-dot ${state.health === "ok" ? "ok" : ""}`}
            title={`后端${state.health === "ok" ? "已连接" : state.health === "loading" ? "检查中" : "未连接"}`}
            aria-label={`后端${state.health === "ok" ? "已连接" : state.health === "loading" ? "检查中" : "未连接"}`}
          >
            <i aria-hidden="true" />
          </span>
          <span className={`model-chip ${state.llmStatus?.configured ? "ok" : "warn"}`}>
            <i aria-hidden="true" />
            {state.llmStatus
              ? `${state.llmStatus.available_models[0] ?? state.llmStatus.provider} · ${state.llmStatus.provider}`
              : "模型状态未知"}
          </span>
          <button
            type="button"
            className={`icon-button ${rightView === "settings" ? "active" : ""}`}
            aria-label="设置"
            onClick={() => {
              setCharactersOpen(false);
              setRightView(rightView === "settings" ? "editor" : "settings");
            }}
          >
            <Settings size={16} />
          </button>
          <button type="button" className="icon-button" aria-label="切换主题" onClick={() => state.toggleTheme()}>
            {state.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="workspace" style={{ gridTemplateColumns: columns }}>
        <aside className="sidebar" aria-label="结构栏">
          <TreePane
            chapters={state.chapters}
            selectedChapterId={state.selectedChapterId}
            activeFile={rightView === "files" ? activeFile : null}
            briefRows={briefRows}
            settingFiles={metas.filter((meta) => meta.layer === "设定")}
            creatingChapter={state.creatingChapter}
            createError={state.createError}
            onCreateChapter={() => void handleCreateChapter()}
            charactersOpen={charactersOpen}
            feedbackOpen={rightView === "feedback"}
            onOpenFile={(path) => void openFile(path)}
            onSelectChapter={(chapterId) => {
              setCharactersOpen(false);
              setRightView("editor");
              state.selectChapter(chapterId);
            }}
            onOpenCharacters={() => setCharactersOpen(true)}
            onOpenFeedback={() => {
              setCharactersOpen(false);
              setRightView("feedback");
            }}
            onOpenWorldMap={() => {
              setCharactersOpen(false);
              setRightView("worldmap");
            }}
            onOpenForeshadow={() => {
              setCharactersOpen(false);
              setRightView("foreshadow");
            }}
            worldMapOpen={rightView === "worldmap"}
            foreshadowOpen={rightView === "foreshadow"}
          />
        </aside>

        <Splitter
          pane="sidebar"
          label="结构栏"
          width={panes.sidebar}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          onDragStart={beginDrag}
          onNudge={nudge}
          onReset={resetPane}
        />

        {charactersOpen ? (
          <CharacterLibrary novelId={state.selectedNovelId} />
        ) : (
          <>
            <ChatPane />

            <Splitter
              pane="chat"
              label="对话栏"
              width={panes.chat}
              min={CHAT_MIN}
              max={chatMax()}
              onDragStart={beginDrag}
              onNudge={nudge}
              onReset={resetPane}
            />
            <div className="right-column">
              {rightView === "feedback" && <FeedbackPanel novelId={state.selectedNovelId} />}
              {rightView === "settings" && <SettingsPanel novelId={state.selectedNovelId} />}
              {rightView === "worldmap" && <WorldMapPanel novelId={state.selectedNovelId} />}
              {rightView === "foreshadow" && <ForeshadowWall novelId={state.selectedNovelId} />}
              {rightView === "files" && <FileEditorPane />}
              {rightView === "editor" && <EditorPane />}
            </div>
          </>
        )}
      </main>

      {/* 批注 19: the bar said the chapter name a second time and announced that
          the client reached the server, which is only news when it fails. The
          health dot moved up beside the model chip where a reader already looks;
          the count now lives with the editor that owns it. */}
      {state.error && !chapter ? <p className="status-error global-error">{state.error}</p> : null}
    </div>
  );
}
