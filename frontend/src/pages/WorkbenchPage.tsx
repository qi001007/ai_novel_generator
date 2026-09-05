import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, MessagesSquare, PanelLeft, PanelRight, Settings } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import CharacterLibrary from "../components/CharacterLibrary";
import ChatPane from "../components/ChatPane";
import EditorPane from "../components/EditorPane";
import FeedbackPanel from "../components/FeedbackPanel";
import FileEditorPane from "../components/FileEditorPane";
import ForeshadowWall from "../components/ForeshadowWall";
import Splitter, { type PaneKey } from "../components/Splitter";
import ActivityRail, { type RailPage } from "../components/ActivityRail";
import TreePane, { type BriefRow } from "../components/TreePane";
import WorldMapPanel from "../components/WorldMapPanel";
import { briefChapter, briefPath, draftChapter, useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";

type RightView = "editor" | "files" | "feedback" | "worldmap" | "foreshadow" | "characters";

type Panes = { sidebar: number; chat: number };

// Defaults follow UI-DESIGN.md and the approved frames: 280 / 470 / rest.
// 帧 27: the tree lost its right of way to the rail, and the rows need the width
// they had. 260 is the narrowest a row like "0001  草稿" still fits.
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 300;
const CHAT_MIN = 400;
/* Dragging a boundary past its pane puts that pane away - 第十五批批注 2.2, an ask
   that has sat on the list for several rounds. 90px is where a column stops being a
   column: the tree row, the chat composer and the editor toolbar all stop fitting,
   so continuing to drag is fighting a strip that cannot hold anything. */
const CLOSE_AT = 90;
/* Bringing the prose column back has to bring it back readable. A drag that closed
   it left the chat pane holding nearly the whole window, so a plain un-hide came
   back as a 113px strip - measured. The chat pane gives the room back. */
const EDITOR_MIN = 420;
const CHAT_DEFAULT_RATIO = 0.327; // 470 / 1440
const PANE_STORAGE_KEY = "workbench.panes";
const HIDDEN_STORAGE_KEY = "workbench.hidden";

type HiddenKey = "sidebar" | "chat" | "editor";
type Hidden = Record<HiddenKey, boolean>;

function readHidden(): Hidden {
  const base: Hidden = { sidebar: false, chat: false, editor: false };
  try {
    const raw = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Hidden>;
    const next = { ...base, ...parsed };
    // A stored state that hides both remaining columns is unreadable, so it is
    // refused rather than honoured.
    return next.chat && next.editor ? base : next;
  } catch {
    return base;
  }
}

/* The prose column may be squeezed all the way to the closing threshold - that is
   what 第十五批批注 2.2 asks for - so the chat pane's ceiling is only whatever the
   window has left after the rail, the tree, the two seams and CLOSE_AT. It used to
   reserve a flat 560px, which meant the editor could never be dragged shut. */
function chatMax(sidebar: number) {
  return Math.max(CHAT_MIN, window.innerWidth - 44 - sidebar - 2 - CLOSE_AT);
}

function chatDefault(sidebar: number) {
  return clampPane("chat", Math.round(window.innerWidth * CHAT_DEFAULT_RATIO), sidebar);
}

function clampPane(pane: PaneKey, value: number, sidebar = SIDEBAR_DEFAULT) {
  const min = pane === "sidebar" ? SIDEBAR_MIN : CHAT_MIN;
  const max = pane === "sidebar" ? SIDEBAR_MAX : chatMax(sidebar);
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultPanes(): Panes {
  return { sidebar: SIDEBAR_DEFAULT, chat: chatDefault(SIDEBAR_DEFAULT) };
}

function loadPanes(): Panes {
  const base = defaultPanes();
  try {
    const raw = localStorage.getItem(PANE_STORAGE_KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<Panes>;
    // Re-clamp so a width saved on a wide monitor cannot overflow a narrow window.
    const sidebar = clampPane("sidebar", stored.sidebar ?? base.sidebar);
    return {
      sidebar,
      chat: clampPane("chat", stored.chat ?? base.chat, sidebar),
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
  // One source, not two. There used to be a `charactersOpen` boolean beside
  // `rightView`, and the two could disagree: opening 伏笔 cleared the boolean but
  // left rightView alone, and opening 人物 set the boolean without clearing
  // rightView - so both rows stayed lit and the character files could not be
  // reached. 批注 5 was that, reproduced.
  const charactersOpen = rightView === "characters";
  const [railPage, setRailPage] = useState<RailPage>("plan");
  const [panes, setPanes] = useState<Panes>(loadPanes);
  // 批注 14: any of the three columns can be put away, and the choice survives a
  // reload - the layout you settle on is yours, not a default to re-fight.
  const [hidden, setHidden] = useState<Hidden>(readHidden);

  const metas = useFiles((store) => store.metas);
  const activeFile = useFiles((store) => store.active);
  const revealSeq = useFiles((store) => store.revealSeq);
  const stage = useFiles((store) => store.stage);
  const attachFiles = useFiles((store) => store.attach);
  const openFile = useFiles((store) => store.open);
  const refreshMetas = useFiles((store) => store.refreshMetas);

  // All three entries land here, so they cannot drift apart.
  async function handleCreateChapter() {
    const created = await state.createNextChapter();
    if (created === null) return;
    await refreshMetas();
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

  useEffect(() => {
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hidden));
  }, [hidden]);

  /* One guard for every door: chat and editor between them must keep at least one
     column standing, or the window ends up showing nothing but the rail. */
  function applyHidden(next: Hidden) {
    if (next.chat && next.editor) return;
    setHidden(next);
  }

  function toggleHidden(key: HiddenKey) {
    // Un-hiding the prose column takes the room back from the chat pane, which grew
    // into it when the column went away.
    if (key === "editor" && hidden.editor) {
      const room =
        window.innerWidth -
        44 -
        (hidden.sidebar ? 0 : sidebarWidth + 1) -
        (hidden.chat ? 0 : 1) -
        EDITOR_MIN;
      writePane("chat", clampPane("chat", Math.min(panes.chat, room), sidebarWidth));
    }
    applyHidden({ ...hidden, [key]: !hidden[key] });
  }

  /* Closing by drag lands in the same state as closing by the top-bar icon, so the
     icon goes unpressed and the width a pane comes back to is the width it had
     before - not the default. 第十五批批注 2.2 的判据就是这两条。 */
  function closePane(key: HiddenKey) {
    // Idempotent on purpose, and this is the bug it hides: a drag or a run of arrow
    // keys keeps firing after the column is gone, and a toggle would answer that by
    // bringing it straight back - measured, the twelfth ArrowRight re-opened what the
    // eleventh had closed.
    if (hidden[key]) return;
    // A drag that ends in a close leaves the pane one pixel above the threshold;
    // putting it away with that width stored means the icon brings back a strip
    // nobody can use. So the width goes back to the resting minimum first.
    if (key === "sidebar" || key === "chat") {
      writePane(key, clampPane(key, panes[key]));
    }
    applyHidden({ ...hidden, [key]: true });
  }

  const sidebarWidth = clampPane("sidebar", panes.sidebar);
  const chatWidth = charactersOpen ? 0 : clampPane("chat", panes.chat, sidebarWidth);
  // Tracks are built to match what is actually rendered: hidden panels become
  // display:none, and a track left over with no item in it is a dead gap.
  const columns = (() => {
    const tracks: string[] = ["44px"];
    // The rail never collapses: it is how you get a page back.
    if (!hidden.sidebar) tracks.push(`${sidebarWidth}px`, "1px");
    if (charactersOpen) {
      tracks.push("minmax(0, 1fr)");
    } else if (hidden.editor) {
      if (!hidden.chat) tracks.push("minmax(0, 1fr)");
    } else {
      if (!hidden.chat) tracks.push(`${chatWidth}px`, "1px");
      tracks.push("minmax(0, 1fr)");
    }
    return tracks.join(" ");
  })();
  const hiddenAttr = (["sidebar", "chat", "editor"] as HiddenKey[])
    .filter((key) => hidden[key])
    .join(" ");

  function writePane(pane: PaneKey, width: number) {
    setPanes((prev) => ({
      ...prev,
      sidebar: pane === "sidebar" ? width : prev.sidebar,
      chat: pane === "chat" ? width : prev.chat,
    }));
  }

  /* Where the prose column would end up if the pointer got what it is asking for.
     The tracks are 44px rail, then sidebar + seam, then chat + seam, then the rest,
     so the last column is whatever the window has left - and it is the one a
     rightward drag squeezes. Derived from the *raw* pointer value on purpose: the
     resting ceiling clamps the chat pane to exactly CLOSE_AT for the editor, so
     judging the clamped value would leave one pixel that never closes. */
  function editorWidthIf(pane: PaneKey, raw: number) {
    const sidebar = pane === "sidebar" ? raw : panes.sidebar;
    const chat = pane === "chat" ? raw : panes.chat;
    return (
      window.innerWidth -
      44 -
      (hidden.sidebar ? 0 : sidebar + 1) -
      (hidden.chat ? 0 : chat + 1)
    );
  }

  /* While a boundary is being dragged the floor is CLOSE_AT, not the resting min:
     the column has to visibly collapse into the edge, or the pointer travels three
     hundred pixels with nothing moving and then the pane vanishes for no reason.
     The resting min still guards a width that comes back from storage. */
  function dragPane(pane: PaneKey, raw: number) {
    const max = pane === "sidebar" ? SIDEBAR_MAX : chatMax(panes.sidebar);
    return Math.min(max, Math.max(CLOSE_AT, Math.round(raw)));
  }

  /* One rule for the pointer and the keyboard: a pane dragged or nudged under the
     floor closes, and a prose column squeezed under it closes. Returns true when
     the gesture is over because something just went away. */
  function applyPane(pane: PaneKey, raw: number) {
    if (raw < CLOSE_AT) {
      closePane(pane);
      return true;
    }
    if (editorWidthIf(pane, raw) < CLOSE_AT) {
      // The prose column is the one being crushed: put it away and stop, or the
      // pointer keeps dragging a column that is no longer there.
      closePane("editor");
      return true;
    }
    writePane(pane, dragPane(pane, raw));
    return false;
  }

  function beginDrag(pane: PaneKey, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = pane === "sidebar" ? panes.sidebar : panes.chat;

    function onMove(moveEvent: PointerEvent) {
      if (applyPane(pane, startWidth + moveEvent.clientX - startX)) stopDrag();
    }
    function stopDrag() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopDrag);
      document.body.classList.remove("resizing");
    }

    document.body.classList.add("resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopDrag);
  }

  function nudge(pane: PaneKey, delta: number) {
    const current = pane === "sidebar" ? panes.sidebar : panes.chat;
    applyPane(pane, current + delta);
  }

  function resetPane(pane: PaneKey) {
    writePane(pane, pane === "sidebar" ? SIDEBAR_DEFAULT : chatDefault(panes.sidebar));
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
    state.openChapterTab(chapterId);
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
    setRightView("files");
  }, [revealSeq]);

  /* The other direction, same one-signal rule: a draft.md asking to be seen as its
     rendered view means the prose page, which is a different component. 第十五批批注
     1.4 / 3.2: the toggle is one button on one boolean, and the column moves with it
     instead of keeping a second idea of what is open. The sequence is stamped only
     once the chapter is actually there, so a stage request that arrives before the
     chapter list is retried when it lands, rather than being eaten. */
  const lastStage = useRef(stage?.seq ?? 0);
  useEffect(() => {
    if (!stage || stage.seq === lastStage.current) return;
    const number = draftChapter(stage.path);
    if (number === null) return;
    const found = state.chapters.find((item) => item.chapter_number === number);
    if (!found) return;
    lastStage.current = stage.seq;
    state.openChapterTab(found.id);
    setRightView("editor");
  }, [stage, state.chapters]);

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
        {/* Icons in the title bar, not a bar under each column: a collapse
            control that lives inside the thing it hides cannot be reached once
            that thing is gone. */}
        <div className="topbar-right">
            <div className="panel-toggles" role="group" aria-label="栏目显示">
            <button
            type="button"
            className="icon-button"
            aria-pressed={!hidden.sidebar}
            aria-label="显示或隐藏结构栏"
            title="结构栏"
            onClick={() => toggleHidden("sidebar")}
            >
            <PanelLeft size={15} />
            </button>
            <button
            type="button"
            className="icon-button"
            aria-pressed={!hidden.chat}
            aria-label="显示或隐藏对话栏"
            title="对话栏"
            onClick={() => toggleHidden("chat")}
            >
            <MessagesSquare size={15} />
            </button>
            <button
            type="button"
            className="icon-button"
            aria-pressed={!hidden.editor}
            aria-label="显示或隐藏编辑栏"
            title="编辑栏"
            onClick={() => toggleHidden("editor")}
            >
            <PanelRight size={15} />
            </button>
            </div>
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
            className="icon-button"
            aria-label="设置"
            // 批注 1: this gear opened a right-column panel whose heading said 设定库,
            // because the view was named "settings" but rendered the worldview editor.
            // Both gears now open the same /settings page.
            onClick={() => navigate("/settings")}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main
        className="workspace"
        style={{ gridTemplateColumns: columns }}
        data-hidden-panels={hiddenAttr || undefined}
      >
        <ActivityRail page={railPage} onSelect={setRailPage} />
        <aside className="sidebar" aria-label="结构栏">
          <TreePane
            page={railPage}
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
              setRightView("editor");
              // Open it in the strip as well as selecting it, so a chapter you
              // clicked is where a chapter you opened would be.
              state.openChapterTab(chapterId);
            }}
            onOpenCharacters={() => setRightView("characters")}
            onOpenFeedback={() => {
              setRightView("feedback");
            }}
            onOpenWorldMap={() => {
              setRightView("worldmap");
            }}
            onOpenForeshadow={() => {
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
              max={chatMax(sidebarWidth)}
              onDragStart={beginDrag}
              onNudge={nudge}
              onReset={resetPane}
            />
            <div className="right-column">
              {rightView === "feedback" && <FeedbackPanel novelId={state.selectedNovelId} />}
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
