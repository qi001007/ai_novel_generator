import { useEffect, useState } from "react";

import { api } from "./api";
import type {
  Chapter,
  ChapterBrief,
  ChapterGenerationResponse,
  MachineCheckResult,
  Novel,
} from "./types";

type HealthState = "loading" | "ok" | "error";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "终审失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace">
      <aside className="sidebar">
        <section className="panel">
          <h1>AI 小说工作台</h1>
          <p className={`status-text ${health === "ok" ? "status-ok" : "status-error"}`}>
            后端 {health === "loading" ? "检查中" : health === "ok" ? "正常" : "未连接"}
          </p>
          <ul className="item-list">
            {novels.map((novel) => (
              <li key={novel.id}>
                <button
                  type="button"
                  className={novel.id === selectedNovelId ? "selected" : ""}
                  onClick={() => setSelectedNovelId(novel.id)}
                >
                  {novel.title}
                </button>
              </li>
            ))}
          </ul>
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
        {selectedChapter ? (
          <>
            <header className="editor-header">
              <h2>第 {selectedChapter.chapter_number} 章</h2>
              <span>{selectedChapter.status}</span>
            </header>
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              aria-label="章节正文"
            />
            <div className="toolbar">
              <button type="button" disabled={busy} onClick={() => saveChapter()}>保存</button>
              <button type="button" disabled={busy} onClick={() => runMachineCheck()}>机械校验</button>
              <button type="button" disabled={busy} onClick={() => reviewChapter("accept")}>通过终审</button>
              <button type="button" disabled={busy} onClick={() => reviewChapter("reject")}>打回重写</button>
            </div>
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
      {error ? <p className="status-error global-error">{error}</p> : null}
    </main>
  );
}
