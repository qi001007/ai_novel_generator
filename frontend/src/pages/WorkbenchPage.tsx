import { useEffect } from "react";

import CharactersPanel from "../components/CharactersPanel";
import FeedbackPanel from "../components/FeedbackPanel";
import PlanningPanel from "../components/PlanningPanel";
import SettingsPanel from "../components/SettingsPanel";
import { useWorkbench } from "../store/workbench";

export default function WorkbenchPage() {
  const state = useWorkbench();
  const {
    health,
    llmStatus,
    novels,
    selectedNovelId,
    briefs,
    selectedBriefId,
    chapters,
    selectedChapterId,
    draftContent,
    machineCheck,
    generationRuns,
    reviews,
    error,
    notice,
    busy,
    tab,
  } = state;

  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const selectedBrief = briefs.find((brief) => brief.id === selectedBriefId) ?? null;

  useEffect(() => {
    state.loadChapterRecords();
  }, [selectedNovelId, selectedChapterId, state.recordVersion]);

  useEffect(() => {
    state.setDraftContent(selectedChapter?.content ?? "");
  }, [selectedChapter?.id]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>墨阁</strong>
          <span>AI 长篇连载工作台</span>
        </div>
        <nav className="primary-nav">
          <button type="button" onClick={() => state.setView("bookshelf")}>书架</button>
          <button type="button" className={tab === "write" ? "selected" : ""} onClick={() => state.setTab("write")}>写作</button>
          <button type="button" className={tab === "plan" ? "selected" : ""} onClick={() => state.setTab("plan")}>规划</button>
          <button type="button" className={tab === "feedback" ? "selected" : ""} onClick={() => state.setTab("feedback")}>反馈</button>
        </nav>
        <div className={`service-status ${health === "ok" ? "ok" : "error"}`}>
          <span />
          后端 {health === "loading" ? "检查中" : health === "ok" ? "已连接" : "未连接"}
        </div>
        <div className={`model-status ${llmStatus?.configured ? "ok" : "warn"}`}>
          {llmStatus
            ? `${llmStatus.provider} · ${llmStatus.configured ? "模型已配置" : "模型未配置"}`
            : "模型状态未知"}
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="panel novel-summary">
            <h1>{novels.find((item) => item.id === selectedNovelId)?.title ?? "未选择作品"}</h1>
            <p>{chapters.length} 章 · {briefs.length} 份简报</p>
          </section>
          <section className="panel">
            <h2>D 层简报</h2>
            <ul className="item-list">
              {briefs.map((brief) => (
                <li key={brief.id}>
                  <button
                    type="button"
                    className={brief.id === selectedBriefId ? "selected" : ""}
                    onClick={() => state.selectBrief(brief.id)}
                  >
                    第 {brief.chapter_number} 章
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="primary" disabled={busy || !selectedBrief} onClick={() => state.generateDraft()}>
              生成草稿
            </button>
          </section>
          <section className="panel">
            <h2>章节</h2>
            <ul className="item-list">
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    className={chapter.id === selectedChapterId ? "selected" : ""}
                    onClick={() => state.selectChapter(chapter.id)}
                  >
                    第 {chapter.chapter_number} 章 {chapter.status}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="editor">
          {tab === "plan" ? (
            <PlanningPanel novelId={selectedNovelId} />
          ) : tab === "feedback" ? (
            <FeedbackPanel novelId={selectedNovelId} />
          ) : selectedChapter ? (
            <>
              <header className="editor-header">
                <div>
                  <h2>第 {selectedChapter.chapter_number} 章 {selectedChapter.title}</h2>
                  <p className="editor-meta">
                    D 简报 · 视角 {selectedBrief?.pov || "未设置"} · {selectedChapter.word_count} 字
                  </p>
                </div>
                <span>{selectedChapter.status}</span>
              </header>
              <textarea
                value={draftContent}
                onChange={(event) => state.setDraftContent(event.target.value)}
                aria-label="章节正文"
              />
              <div className="toolbar">
                <button type="button" disabled={busy} onClick={() => state.saveChapter()}>保存</button>
                <button type="button" disabled={busy} onClick={() => state.runAiReview()}>AI 自检</button>
                <button type="button" disabled={busy} onClick={() => state.runMachineCheck()}>机械校验</button>
                <button type="button" disabled={busy} onClick={() => state.reviewChapter("accept")}>通过终审</button>
                <button type="button" disabled={busy} onClick={() => state.reviewChapter("reject")}>打回重写</button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || selectedChapter.status !== "final"}
                  onClick={() => state.extractChapterFacts()}
                >
                  事实落库
                </button>
              </div>
              {notice ? <p className="notice">{notice}</p> : null}
              {machineCheck ? (
                <section className={machineCheck.passed ? "check-result passed" : "check-result failed"}>
                  <strong>{machineCheck.passed ? "校验通过" : "校验未通过"}</strong>
                  <ul>
                    {machineCheck.issues.map((issue, index) => (
                      <li key={`${issue.type}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <section className="panel empty-state">
              <h2>章节编辑</h2>
              <p>还没有章节。</p>
            </section>
          )}
        </section>

        <section className="library">
          <section className="panel">
            <h2>生成与审稿记录</h2>
            <ul className="record-list">
              {generationRuns.map((run) => (
                <li key={`run-${run.id}`}>
                  <strong>{run.model}</strong>
                  <span>{run.task_type}</span>
                  <span>{run.token_input} / {run.token_output}</span>
                </li>
              ))}
              {reviews.map((review) => (
                <li key={`review-${review.id}`}>
                  <strong>{review.reviewer}</strong>
                  <span>{review.decision}</span>
                  {review.comments ? <p>{review.comments}</p> : null}
                </li>
              ))}
            </ul>
          </section>
          <SettingsPanel novelId={selectedNovelId} />
          <CharactersPanel novelId={selectedNovelId} />
        </section>
      </main>
      {error ? <p className="status-error global-error">{error}</p> : null}
    </div>
  );
}
