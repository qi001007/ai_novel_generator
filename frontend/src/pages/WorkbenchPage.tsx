import { useEffect, useState } from "react";
import { ArrowLeft, Moon, Settings, Sun } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import CharacterLibrary from "../components/CharacterLibrary";
import ChatPane from "../components/ChatPane";
import EditorPane from "../components/EditorPane";
import FeedbackPanel from "../components/FeedbackPanel";
import ForeshadowWall from "../components/ForeshadowWall";
import PlanningPanel from "../components/PlanningPanel";
import SettingsPanel from "../components/SettingsPanel";
import TreePane, { type PlanningLayer } from "../components/TreePane";
import WorldMapPanel from "../components/WorldMapPanel";
import { useWorkbench } from "../store/workbench";

type RightView = "editor" | "planning" | "feedback" | "settings" | "worldmap" | "foreshadow";

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const { novelId: novelIdParam } = useParams();
  const state = useWorkbench();
  const [rightView, setRightView] = useState<RightView>("editor");
  const [planningLayer, setPlanningLayer] = useState<PlanningLayer>("A");
  const [charactersOpen, setCharactersOpen] = useState(false);

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

      <main className={`workspace ${charactersOpen ? "library-open" : ""}`}>
        <aside className="sidebar" aria-label="结构栏">
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

        {charactersOpen ? (
          <CharacterLibrary novelId={state.selectedNovelId} />
        ) : (
          <>
            <ChatPane />
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
