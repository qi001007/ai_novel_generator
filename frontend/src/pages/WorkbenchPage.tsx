import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Moon, Settings, Sun } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import CharacterLibrary from "../components/CharacterLibrary";
import ChatPane from "../components/ChatPane";
import EditorPane from "../components/EditorPane";
import FeedbackPanel from "../components/FeedbackPanel";
import ForeshadowWall from "../components/ForeshadowWall";
import PlanningPanel from "../components/PlanningPanel";
import SettingsPanel from "../components/SettingsPanel";
import Splitter, { type PaneKey } from "../components/Splitter";
import TreePane, { type PlanningLayer } from "../components/TreePane";
import WorldMapPanel from "../components/WorldMapPanel";
import { useWorkbench } from "../store/workbench";

type RightView = "editor" | "planning" | "feedback" | "settings" | "worldmap" | "foreshadow";

type Panes = {
  sidebar: number;
  chat: number;
  sidebarClosed: boolean;
  chatClosed: boolean;
};

// Defaults follow UI-DESIGN.md: sidebar 280px, chat minmax(400px, 34%).
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 280;
const CHAT_MIN = 400;
const PANE_STORAGE_KEY = "workbench.panes";

function chatMax() {
  return Math.max(CHAT_MIN, window.innerWidth - 560);
}

function chatDefault() {
  return clampPane("chat", Math.round(window.innerWidth * 0.34));
}

function clampPane(pane: PaneKey, value: number) {
  const min = pane === "sidebar" ? SIDEBAR_MIN : CHAT_MIN;
  const max = pane === "sidebar" ? SIDEBAR_MAX : chatMax();
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultPanes(): Panes {
  return {
    sidebar: SIDEBAR_DEFAULT,
    chat: chatDefault(),
    sidebarClosed: false,
    chatClosed: false,
  };
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
      sidebarClosed: Boolean(stored.sidebarClosed),
      chatClosed: Boolean(stored.chatClosed),
    };
  } catch {
    return base;
  }
}

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const { novelId: novelIdParam } = useParams();
  const state = useWorkbench();
  const [rightView, setRightView] = useState<RightView>("editor");
  const [planningLayer, setPlanningLayer] = useState<PlanningLayer>("A");
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [panes, setPanes] = useState<Panes>(loadPanes);

  useEffect(() => {
    localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(panes));
  }, [panes]);

  const sidebarWidth = panes.sidebarClosed ? 0 : clampPane("sidebar", panes.sidebar);
  const chatWidth = charactersOpen || panes.chatClosed ? 0 : clampPane("chat", panes.chat);
  const columns = charactersOpen
    ? `${sidebarWidth}px 5px minmax(0, 1fr)`
    : `${sidebarWidth}px 5px ${chatWidth}px 5px minmax(0, 1fr)`;

  function writePane(pane: PaneKey, width: number) {
    setPanes((prev) => ({
      ...prev,
      sidebar: pane === "sidebar" ? width : prev.sidebar,
      chat: pane === "chat" ? width : prev.chat,
      sidebarClosed: pane === "sidebar" ? false : prev.sidebarClosed,
      chatClosed: pane === "chat" ? false : prev.chatClosed,
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

  function togglePane(pane: PaneKey) {
    setPanes((prev) =>
      pane === "sidebar"
        ? { ...prev, sidebarClosed: !prev.sidebarClosed }
        : { ...prev, chatClosed: !prev.chatClosed },
    );
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

  useEffect(() => {
    state.loadChapterRecords();
  }, [state.selectedNovelId, state.selectedChapterId, state.recordVersion]);

  const chapter = state.chapters.find((item) => item.id === state.selectedChapterId) ?? null;

  useEffect(() => {
    state.setDraftContent(chapter?.content ?? "");
  }, [chapter?.id]);

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
        <div className="topbar-center" aria-hidden="true">
          <kbd>Ctrl</kbd>+<kbd>K</kbd> 命令面板（C5 接入）
        </div>
        <div className="topbar-right">
          <span className={`model-chip ${state.llmStatus?.configured ? "ok" : "warn"}`}>
            <i aria-hidden="true" />
            {state.llmStatus
              ? `${state.llmStatus.provider} · ${state.llmStatus.configured ? "模型已配置" : "模型未配置"}`
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
        <aside
          className={`sidebar ${panes.sidebarClosed ? "collapsed" : ""}`}
          aria-label="结构栏"
        >
          <TreePane
            chapters={state.chapters}
            selectedChapterId={state.selectedChapterId}
            activePlanningLayer={rightView === "planning" ? planningLayer : null}
            charactersOpen={charactersOpen}
            feedbackOpen={rightView === "feedback"}
            onOpenPlanning={(layer) => {
              setPlanningLayer(layer);
              setCharactersOpen(false);
              setRightView("planning");
            }}
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
          collapsed={panes.sidebarClosed}
          onDragStart={beginDrag}
          onNudge={nudge}
          onToggle={togglePane}
          onReset={resetPane}
        />

        {charactersOpen ? (
          <CharacterLibrary novelId={state.selectedNovelId} />
        ) : (
          <>
            <ChatPane className={panes.chatClosed ? "collapsed" : ""} />

            <Splitter
              pane="chat"
              label="对话栏"
              width={panes.chat}
              min={CHAT_MIN}
              max={chatMax()}
              collapsed={panes.chatClosed}
              onDragStart={beginDrag}
              onNudge={nudge}
              onToggle={togglePane}
              onReset={resetPane}
            />
            <div className="right-column">
              {rightView === "planning" && (
                <PlanningPanel novelId={state.selectedNovelId} initialLayer={planningLayer} />
              )}
              {rightView === "feedback" && <FeedbackPanel novelId={state.selectedNovelId} />}
              {rightView === "settings" && <SettingsPanel novelId={state.selectedNovelId} />}
              {rightView === "worldmap" && <WorldMapPanel novelId={state.selectedNovelId} />}
              {rightView === "foreshadow" && <ForeshadowWall novelId={state.selectedNovelId} />}
              {rightView === "editor" && <EditorPane />}
            </div>
          </>
        )}
      </main>

      <footer className="statusbar">
        <span>
          <i className={`dot ${state.health === "ok" ? "ok" : ""}`} aria-hidden="true" />
          后端 {state.health === "ok" ? "已连接" : state.health === "loading" ? "检查中" : "未连接"}
        </span>
        <span>{chapter ? `第 ${chapter.chapter_number} 章 ${chapter.title || "未命名"}` : "未选章节"}</span>
        <span className="tabular">
          {chapter ? `${chapter.word_count} 字` : ""}
        </span>
      </footer>
      {state.error && !chapter ? <p className="status-error global-error">{state.error}</p> : null}
    </div>
  );
}
