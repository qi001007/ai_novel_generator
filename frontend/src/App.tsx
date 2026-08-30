import { useEffect, useState } from "react";

import { api } from "./api";
import type {
  Chapter,
  ChapterBrief,
  ChapterGenerationResponse,
  MachineCheckResult,
  Novel,
  Review,
  GenerationRun,
  LLMStatus,
} from "./types";

import CharactersPanel from "./components/CharactersPanel";
import SettingsPanel from "./components/SettingsPanel";
import PlanningPanel from "./components/PlanningPanel";
import FeedbackPanel from "./components/FeedbackPanel";

type HealthState = "loading" | "ok" | "error";
type WorkspaceTab = "write" | "plan" | "feedback";

export default function App() {
  const [health, setHealth] = useState<HealthState>("loading");
  const [novels, setNovels] = useState<Novel[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState<number | null>(null);
  const [briefs, setBriefs] = useState<ChapterBrief[]>([]);
  const [selectedBriefId, setSelectedBriefId] = useState<number | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [machineCheck, setMachineCheck] = useState<MachineCheckResult | null>(null);
  const [generationRuns, setGenerationRuns] = useState<GenerationRun[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [recordVersion, setRecordVersion] = useState(0);
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("write");

  useEffect(() => {
    let active = true;

    api.get<{ status: string }>("/api/health").then(() => {
      if (active) setHealth("ok");
    }).catch(() => {
      if (active) setHealth("error");
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    api.get<LLMStatus>("/api/llm/status").then((data) => {
      if (active) setLlmStatus(data);
    }).catch(() => {
      if (active) setLlmStatus(null);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    api.get<Novel[]>("/api/novels").then((data) => {
      if (!active) return;
      setNovels(data);
      setSelectedNovelId(data[0]?.id ?? null);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedNovelId === null) return;

    let active = true;

    Promise.all([
      api.get<ChapterBrief[]>(`/api/novels/${selectedNovelId}/planning/briefs`),
      api.get<Chapter[]>(`/api/novels/${selectedNovelId}/chapters`),
    ]).then(([briefData, chapterData]) => {
      if (!active) return;
      setBriefs(briefData);
      setSelectedBriefId(briefData[0]?.id ?? null);
      setChapters(chapterData);
      setSelectedChapterId(chapterData[0]?.id ?? null);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [selectedNovelId]);

  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const selectedBrief = briefs.find((brief) => brief.id === selectedBriefId) ?? null;

  useEffect(() => {
    setDraftContent(selectedChapter?.content ?? "");
  }, [selectedChapter?.id]);

  useEffect(() => {
    if (!selectedNovelId || !selectedChapterId) {
      setGenerationRuns([]);
      setReviews([]);
      return;
    }

    let active = true;

    Promise.all([
      api.get<GenerationRun[]>(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/generation-runs`,
      ),
      api.get<Review[]>(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapterId}/reviews`,
      ),
    ]).then(([runs, reviewData]) => {
      if (!active) return;
      setGenerationRuns(runs);
      setReviews(reviewData);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [selectedNovelId, selectedChapterId, recordVersion]);

  async function refreshChapters(novelId: number) {
    const data = await api.get<Chapter[]>(`/api/novels/${novelId}/chapters`);
    setChapters(data);
  }

  async function generateDraft() {
    if (!selectedNovelId || !selectedBrief) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ChapterGenerationResponse>(
        `/api/novels/${selectedNovelId}/chapters/from-brief/${selectedBrief.id}`,
      );
      await refreshChapters(selectedNovelId);
      setSelectedChapterId(result.chapter.id);
      setMachineCheck(result.machine_check);
      setRecordVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveChapter() {
    if (!selectedNovelId || !selectedChapter) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await api.put<Chapter>(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapter.id}`,
        {
          brief_id: selectedChapter.brief_id,
          chapter_number: selectedChapter.chapter_number,
          title: selectedChapter.title,
          content: draftContent,
          status: selectedChapter.status,
        },
      );
      setChapters((current) => current.map((chapter) => (
        chapter.id === updated.id ? updated : chapter
      )));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function runMachineCheck() {
    if (!selectedNovelId || !selectedChapter) return;

    setBusy(true);
    setError(null);
    try {
      const brief = briefs.find((item) => item.id === selectedChapter.brief_id);
      const result = await api.post<MachineCheckResult>(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapter.id}/machine-check`,
        { required_facts: brief?.required_facts ?? [] },
      );
      setMachineCheck(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "机械校验失败");
    } finally {
      setBusy(false);
    }
  }

  async function reviewChapter(decision: "accept" | "reject") {
    if (!selectedNovelId || !selectedChapter) return;

    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapter.id}/final-review`,
        { decision, comments: "" },
      );
      await refreshChapters(selectedNovelId);
      setRecordVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "终审失败");
    } finally {
      setBusy(false);
    }
  }

  async function runAiReview() {
    if (!selectedNovelId || !selectedChapter) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapter.id}/auto-ai-review`,
      );
      await refreshChapters(selectedNovelId);
      setRecordVersion((version) => version + 1);
      setNotice("AI 七维自检完成");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 自检失败");
    } finally {
      setBusy(false);
    }
  }

  async function extractChapterFacts() {
    if (!selectedNovelId || !selectedChapter) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(
        `/api/novels/${selectedNovelId}/chapters/${selectedChapter.id}/auto-summary`,
      );
      setRecordVersion((version) => version + 1);
      setNotice("章摘要与事实已落库");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "事实提取失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>墨阁</strong>
          <span>AI 长篇连载工作台</span>
        </div>
        <nav className="primary-nav">
          <button
            type="button"
            className={tab === "write" ? "selected" : ""}
            onClick={() => setTab("write")}
          >
            写作
          </button>
          <button
            type="button"
            className={tab === "plan" ? "selected" : ""}
            onClick={() => setTab("plan")}
          >
            规划
          </button>
          <button
            type="button"
            className={tab === "feedback" ? "selected" : ""}
            onClick={() => setTab("feedback")}
          >
            反馈
          </button>
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
            <p>
              {chapters.length} 章 · {briefs.length} 份简报
            </p>
          </section>
        <section className="panel">
          <h2>D 层简报</h2>
          <ul className="item-list">
            {briefs.map((brief) => (
              <li key={brief.id}>
                <button
                  type="button"
                  className={brief.id === selectedBriefId ? "selected" : ""}
                  onClick={() => setSelectedBriefId(brief.id)}
                >
                  第 {brief.chapter_number} 章
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary"
            disabled={busy || !selectedBrief}
            onClick={() => generateDraft()}
          >
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
                  onClick={() => setSelectedChapterId(chapter.id)}
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
                <h2>
                  第 {selectedChapter.chapter_number} 章 {selectedChapter.title}
                </h2>
                <p className="editor-meta">
                  D 简报 · 视角 {selectedBrief?.pov || "未设置"} · {selectedChapter.word_count} 字
                </p>
              </div>
              <span>{selectedChapter.status}</span>
            </header>
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              aria-label="章节正文"
            />
            <div className="toolbar">
              <button type="button" disabled={busy} onClick={() => saveChapter()}>保存</button>
              <button type="button" disabled={busy} onClick={() => runAiReview()}>AI 自检</button>
              <button type="button" disabled={busy} onClick={() => runMachineCheck()}>机械校验</button>
              <button type="button" disabled={busy} onClick={() => reviewChapter("accept")}>通过终审</button>
              <button type="button" disabled={busy} onClick={() => reviewChapter("reject")}>打回重写</button>
              <button
                type="button"
                className="primary"
                disabled={busy || selectedChapter.status !== "final"}
                onClick={() => extractChapterFacts()}
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
                <span>
                  {run.token_input} / {run.token_output}
                </span>
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
      {error ? <p className="status-error global-error">{error}</p> : null}
      </main>
    </div>
  );
}
