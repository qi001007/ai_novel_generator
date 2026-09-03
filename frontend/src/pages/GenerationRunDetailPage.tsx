import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, FileText, RefreshCcw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import type {
  Chapter,
  ChapterBrief,
  ContextManifest,
  ContextManifestBlock,
  GenerationRun,
  MachineCheckResult,
  Novel,
  Review,
} from "../types";

type DetailTab = "context" | "output" | "check" | "review";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "context", label: "注入了哪些资料" },
  { id: "output", label: "模型写出的正文" },
  { id: "check", label: "机械校验" },
  { id: "review", label: "审稿记录" },
];

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

function parseManifest(text: string): ContextManifest | null {
  if (!text.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as ContextManifest;
    return Array.isArray(parsed.blocks) ? parsed : null;
  } catch {
    return null;
  }
}

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value).then(() => {
    window.alert(`${label}已复制`);
  });
}

export default function GenerationRunDetailPage() {
  const navigate = useNavigate();
  const params = useParams();
  const novelId = Number(params.novelId);
  const chapterId = Number(params.chapterId);
  const runId = Number(params.runId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [brief, setBrief] = useState<ChapterBrief | null>(null);
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [runs, setRuns] = useState<GenerationRun[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [machineCheck, setMachineCheck] = useState<MachineCheckResult | null>(null);
  const [tab, setTab] = useState<DetailTab>("context");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(novelId) || !Number.isFinite(chapterId) || !Number.isFinite(runId)) {
      setError("调用链接不完整");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const [novels, chapters, runs, briefs, reviews] = await Promise.all([
          api.get<Novel[]>("/api/novels"),
          api.get<Chapter[]>(`/api/novels/${novelId}/chapters`),
          api.get<GenerationRun[]>(
            `/api/novels/${novelId}/chapters/${chapterId}/generation-runs`,
          ),
          api.get<ChapterBrief[]>(`/api/novels/${novelId}/planning/briefs`),
          api.get<Review[]>(`/api/novels/${novelId}/chapters/${chapterId}/reviews`),
        ]);
        const nextChapter = chapters.find((item) => item.id === chapterId) ?? null;
        const nextRun = runs.find((item) => item.id === runId) ?? null;
        if (!nextChapter || !nextRun) throw new Error("没有找到这次调用记录");
        const nextBrief =
          briefs.find((item) => item.id === nextChapter.brief_id) ??
          briefs.find((item) => item.chapter_number === nextChapter.chapter_number) ??
          null;

        if (cancelled) return;
        setNovel(novels.find((item) => item.id === novelId) ?? null);
        setChapter(nextChapter);
        setBrief(nextBrief);
        setRun(nextRun);
        setRuns(runs);
        setReviews(reviews);

        const check = await api.post<MachineCheckResult>(
          `/api/novels/${novelId}/chapters/${chapterId}/machine-check`,
          { required_facts: nextBrief?.required_facts ?? [] },
        );
        if (!cancelled) setMachineCheck(check);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "调用详情加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [chapterId, novelId, runId]);

  const manifest = useMemo(
    () => (run ? parseManifest(run.input_summary) : null),
    [run],
  );

  const groupedBlocks = useMemo(() => {
    if (!manifest) return [];
    const names = ["必注入", "连续性", "邻域", "填充"];
    return names
      .map((tier) => ({
        tier,
        blocks: manifest.blocks.filter((block) => (block.tier ?? "填充") === tier),
      }))
      .filter((group) => group.blocks.length > 0);
  }, [manifest]);

  const selectedBlock = useMemo<ContextManifestBlock | null>(() => {
    if (!manifest) return null;
    const blocks = manifest.blocks;
    return (
      blocks.find((block, index) => `${block.ref}:${block.index ?? index}` === selectedKey) ??
      blocks.find((block) => block.injected && block.kind === "brief") ??
      blocks.find((block) => block.injected) ??
      null
    );
  }, [manifest, selectedKey]);

  async function retryRun() {
    if (!brief || !run) return;
    try {
      const result = await api.post<{
        chapter: Chapter;
        generation_run: GenerationRun;
      }>(`/api/novels/${novelId}/chapters/from-brief/${brief.id}`);
      navigate(`/novels/${novelId}/chapters/${result.chapter.id}/runs/${result.generation_run.id}`, {
        replace: true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重试失败");
    }
  }

  if (loading) {
    return (
      <main className="run-detail-page" aria-label="调用详情">
        <div className="run-detail-empty">调用详情加载中…</div>
      </main>
    );
  }

  if (error || !run || !chapter) {
    return (
      <main className="run-detail-page" aria-label="调用详情">
        <div className="run-detail-empty">
          <FileText size={24} aria-hidden="true" />
          <h1>调用详情不可用</h1>
          <p>{error ?? "没有找到这次调用记录"}</p>
          <button type="button" className="run-button secondary" onClick={() => navigate(-1)}>
            返回
          </button>
        </div>
      </main>
    );
  }

  const cost = run.cost_estimate > 0 ? `¥ ${run.cost_estimate.toFixed(2)}` : "¥ —";
  const runIndex = runs.findIndex((item) => item.id === run.id);

  return (
    <main className="run-detail-page" aria-label="AI 调用详情">
      <header className="run-detail-topbar">
        <button
          type="button"
          className="icon-button"
          aria-label="返回正文"
          onClick={() => navigate(`/novels/${novelId}?chapter=${chapterId}`)}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="run-detail-heading">
          <h1>
            第 {chapter.chapter_number} 章 {chapter.title || "未命名"} / 调用详情
          </h1>
          <p>
            {run.task_type} run #{run.id} · {formatTime(run.created_at)} · 模型 {run.model}
          </p>
        </div>
        <span className={`run-status ${run.status === "completed" ? "ok" : "warn"}`}>
          {run.status === "completed" ? "已完成" : run.status}
        </span>
        <button
          type="button"
          className="run-button secondary"
          onClick={() => copyText(run.input_summary, "上下文清单 JSON ")}
        >
          复制清单
        </button>
        <button
          type="button"
          className="run-button primary"
          onClick={() => navigate(`/novels/${novelId}?chapter=${chapterId}`)}
        >
          在正文打开
        </button>
      </header>

      <section className="run-kpis" aria-label="本次调用成本">
        <article><span>输入 token</span><strong className="tabular">{run.token_input}</strong><small>模型请求</small></article>
        <article><span>输出 token</span><strong className="tabular">{run.token_output}</strong><small>含正文与控制符</small></article>
        <article>
          <span>注入上下文</span>
          <strong className="tabular">{manifest ? `${manifest.used} / ${manifest.budget}` : "—"}</strong>
          <small>{manifest ? `${manifest.blocks.filter((item) => item.injected).length} 块` : "旧格式清单"}</small>
        </article>
        <article><span>正文长度</span><strong className="tabular">{chapter.word_count} 字</strong><small>当前章节内容</small></article>
        <article><span>成本估算</span><strong>{cost}</strong><small>网关未返回时显示 —</small></article>
      </section>

      <div className="run-detail-body">
        <section className="run-detail-main" aria-label="调用结果">
          <div className="run-detail-card">
            <div className="run-detail-card-head">
              <h2>{TABS.find((item) => item.id === tab)?.label}</h2>
              <div className="run-tabs" role="tablist" aria-label="调用详情视图">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className={tab === item.id ? "selected" : ""}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {tab === "context" ? (
              manifest ? (
                <>
                  <div className="manifest-columns" aria-hidden="true">
                    <span>#</span><span>档位</span><span>kind</span><span>注入来源</span>
                    <span>字符</span><span>原因</span>
                  </div>
                  <div className="manifest-list">
                    {groupedBlocks.map((group) => (
                      <section key={group.tier}>
                        <h3>{group.tier} · {group.blocks.length} 块</h3>
                        {group.blocks.map((block, index) => (
                          <button
                            key={`${block.ref}-${block.index ?? index}`}
                            type="button"
                            className={`manifest-row ${block.injected ? "" : "dropped"} ${
                              selectedKey === `${block.ref}:${block.index ?? index}` ? "selected" : ""
                            }`}
                            onClick={() => setSelectedKey(`${block.ref}:${block.index ?? index}`)}
                          >
                            <span className="index">{block.injected ? block.index : "--"}</span>
                            <span className={`tier tier-${block.tier ?? "fill"}`}>{block.tier ?? "填充"}</span>
                            <span className="kind">{block.kind}</span>
                            <span className="source">
                              <strong>{block.label}</strong>
                              <small>{block.ref} · {block.injected ? "已注入" : "未注入"}</small>
                            </span>
                            <span className="chars tabular">{block.chars}</span>
                            <span className="reason">{block.reason || (block.injected ? "符合当前窗口规则" : "未注入")}</span>
                          </button>
                        ))}
                      </section>
                    ))}
                  </div>
                  {selectedBlock ? (
                    <div className="manifest-detail">
                      <header>
                        <strong>{selectedBlock.label} 原文</strong>
                        <span>{selectedBlock.ref} · {selectedBlock.chars} 字 · 模型收到同一份内容</span>
                      </header>
                      <pre>
                        {selectedBlock.excerpt ||
                          "这条旧记录生成于摘录保存功能上线前，这里没有当时的原文。请看模型输出，或重新生成一条新 run。"}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="run-detail-empty compact">
                  <p>这是一条旧格式记录，没有结构化注入清单。</p>
                  <pre>{run.input_summary}</pre>
                </div>
              )
            ) : null}

            {tab === "output" && (
              <div className="run-output">
                <div className="run-output-actions">
                  <button type="button" onClick={() => copyText(run.output, "模型输出")}>
                    <Copy size={13} /> 复制输出
                  </button>
                </div>
                <pre>{run.output || "这次调用没有保存模型输出。"}</pre>
              </div>
            )}

            {tab === "check" && machineCheck && (
              <div className="run-check">
                <header>
                  <strong>{machineCheck.passed ? "机械校验通过" : "机械校验未通过"}</strong>
                  <span className="tabular">{machineCheck.word_count} 字</span>
                </header>
                {machineCheck.issues.length ? (
                  <ul>
                    {machineCheck.issues.map((issue, index) => (
                      <li key={`${issue.type}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p>没有发现问题。</p>
                )}
                <p className="run-check-note">校验按当前正文与 D 简报必要事实现算。</p>
              </div>
            )}

            {tab === "review" && (
              <div className="run-reviews">
                {reviews.length ? reviews.map((review) => (
                  <article key={review.id}>
                    <header>
                      <strong>{review.reviewer === "ai" ? "AI 七维自检" : "人工终审"}</strong>
                      <span>{review.decision} · {formatTime(review.created_at)}</span>
                    </header>
                    {review.comments ? <p>{review.comments}</p> : null}
                    <dl>
                      {Object.entries(review.scores).map(([name, score]) => (
                        <div key={name}><dt>{name}</dt><dd className="tabular">{String(score)}</dd></div>
                      ))}
                    </dl>
                  </article>
                )) : <p className="empty">这一章还没有审稿记录。</p>}
              </div>
            )}
          </div>
        </section>

        <aside className="run-detail-aside">
          <section className="run-side-card">
            <h2>本次调用</h2>
            <dl>
              <div><dt>模型</dt><dd>{run.model}</dd></div>
              <div><dt>任务</dt><dd>{run.task_type} · 正文生成</dd></div>
              <div><dt>开始时间</dt><dd>{formatTime(run.created_at)}</dd></div>
              <div><dt>耗时</dt><dd>—（待后端埋点）</dd></div>
              <div><dt>上下文预算</dt><dd>{manifest ? `${manifest.budget} 字` : "—"}</dd></div>
              <div><dt>执行状态</dt><dd>{run.status === "completed" ? "成功" : run.status}</dd></div>
            </dl>
          </section>

          <section className="run-side-card">
            <h2>链路与产物</h2>
            <dl>
              <div><dt>作品</dt><dd>{novel?.title ?? "未知"} · novel:{novelId}</dd></div>
              <div><dt>章节</dt><dd>第 {chapter.chapter_number} 章 · chapter:{chapter.id}</dd></div>
              <div><dt>D 简报</dt><dd>{brief ? `brief:${brief.id}` : "未关联"}</dd></div>
              <div><dt>正文文件</dt><dd>chapters/{String(chapter.chapter_number).padStart(4, "0")}/draft.md</dd></div>
              <div><dt>Run ID</dt><dd>#{run.id} · generation_run</dd></div>
              <div><dt>清单来源</dt><dd>generation_run.input_summary</dd></div>
              <div><dt>上一轮</dt><dd>{runIndex > 0 ? `#${runs[runIndex - 1].id}` : "—"}</dd></div>
              <div><dt>下一轮</dt><dd>{runIndex >= 0 && runIndex < runs.length - 1 ? `#${runs[runIndex + 1].id}` : "—"}</dd></div>
            </dl>
          </section>

          <section className="run-side-card">
            <h2>下一步</h2>
            <button
              type="button"
              className="run-button primary full"
              onClick={() => navigate(`/novels/${novelId}?chapter=${chapterId}`)}
            >
              在正文打开
            </button>
            <button
              type="button"
              className="run-button secondary full"
              onClick={() => copyText(run.input_summary, "上下文清单 JSON ")}
            >
              复制上下文清单 JSON
            </button>
            <button
              type="button"
              className="run-button secondary full"
              onClick={() => copyText(run.output, "模型输出")}
            >
              复制模型原始输出
            </button>
            <button
              type="button"
              className="run-button ghost full"
              disabled={Boolean(chapter.content.trim())}
              title={chapter.content.trim() ? "已有正文时先打回，避免直接覆盖" : "基于同一份 D 简报生成新 run"}
              onClick={() => void retryRun()}
            >
              <RefreshCcw size={13} /> 重试本次生成
            </button>
            <p>这些操作都在页面内完成；不需要打开后端终端。</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
