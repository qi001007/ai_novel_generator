import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, FileText, RefreshCcw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import {
  fileNameOfKind,
  groupKeyOf,
  layerOfKind,
  layerRank,
  sectionNameOf,
} from "../contextLayers";
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
  { id: "context", label: "注入上下文" },
  { id: "output", label: "模型输出" },
  { id: "check", label: "机械校验" },
  { id: "review", label: "审稿记录" },
];

/* The author knows the plan as four layers. The backend trim tiers are a budget
   mechanic that only decides what gets dropped under pressure, so the manifest
   is grouped by planning layer and the tier word never reaches the prose. */
const KIND_LABELS: Record<string, string> = {
  novel: "作品信息",
  blueprint: "全本蓝图",
  toc: "目录",
  arc: "剧情弧",
  brief: "章简报",
  setting: "设定",
  character: "人物",
  foreshadow: "伏笔",
  summary: "章摘要",
  chapter: "正文",
  chapter_tail: "上章结尾",
  feedback: "审稿意见",
};

/** 交付状态一句话。行里与展开区头部都用它 - 两处各写一遍就会出现两种说法。 */
function deliveryText(group: { blocks: ContextManifestBlock[]; injected: number }): string {
  return group.injected === group.blocks.length
    ? "已交给模型"
    : group.injected === 0
      ? "本次未交给模型"
      : `${group.injected} 节已交 · ${group.blocks.length - group.injected} 节未交`;
}

/**
 * 展开区里的一节（第二十四批批注 2）。
 * 之前每一节都自巸一个灰盒子、都重复一遍文件名与那句「以下就是模型
 * 当时读到的内容」，五节摒下去就是一片。现在名字与状态在头部写一次，
 * 节里只剩小节名、字数与原文；长原文默认截到六行。
 */
function ManifestSection({
  name,
  block,
  showName,
}: {
  name: string;
  block: ContextManifestBlock;
  showName: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const text =
    block.excerpt ||
    "这次调用发生在原文摘录上线之前，没有留下当时的内容。重新生成一次即可看到";
  // 只在截断状态下量溢出＜展开后 clientHeight 等于 scrollHeight，
  // 那时再算会把「收起」按钮自己消灭掉。
  useEffect(() => {
    if (open) return;
    const el = bodyRef.current;
    if (el) setOverflowing(el.scrollHeight - el.clientHeight > 4);
  }, [text, open]);
  return (
    <section className={`manifest-section ${block.injected ? "" : "dropped"}`}>
      {showName ? (
        <h3>
          <span>{name}</span>
          <span className="tabular">{block.chars} 字</span>
        </h3>
      ) : null}
      <p ref={bodyRef} className={`manifest-excerpt ${open ? "" : "clamped"}`}>
        {text}
      </p>
      {overflowing || open ? (
        <button type="button" className="manifest-more" onClick={() => setOpen(!open)}>
          {open ? "收起" : "展开全文"}
        </button>
      ) : null}
    </section>
  );
}

/* 层序与分组键都在 contextLayers.ts - 对话里的清单要用同一份（第二十三批批注 3、4、5）。 */
const layerOf = layerOfKind;

/** 清单里的一行 = 一份文件；blocks 是这份文件被切进去的那几节。 */
type ManifestGroup = {
  key: string;
  kind: string;
  layer: string;
  first: number;
  blocks: ContextManifestBlock[];
  chars: number;
  injected: number;
};

const TASK_LABELS: Record<string, string> = {
  draft: "正文生成",
  review: "AI 审稿",
  summary: "章摘要",
  fact_extract: "事实提取",
  chat: "对话",
};

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


  /* 一行 = 一份文件（批注 5）。blueprint.md 的主线/主题/核心冲突是一行里的几节，
     而三份 chapters/NNNN/brief.md 是三行 - 分组键在 contextLayers.ts 里，
     那里写着哪些 kind 是「一份文件多节」。组序按 A→B→C→D→正文→设定→附件（批注 4）。 */
  const groups = useMemo<ManifestGroup[]>(() => {
    if (!manifest) return [];
    const byKey = new Map<string, ManifestGroup>();
    manifest.blocks.forEach((block, index) => {
      const key = groupKeyOf(block);
      const found = byKey.get(key);
      if (found) {
        found.blocks.push(block);
        found.chars += block.chars;
        if (block.injected) found.injected += 1;
        return;
      }
      byKey.set(key, {
        key,
        kind: block.kind,
        layer: layerOf(block.kind),
        first: index,
        blocks: [block],
        chars: block.chars,
        injected: block.injected ? 1 : 0,
      });
    });
    return [...byKey.values()].sort(
      (a, b) => layerRank(a.layer) - layerRank(b.layer) || a.first - b.first,
    );
  }, [manifest]);

  const selectedGroup = useMemo<ManifestGroup | null>(() => {
    if (!groups.length) return null;
    return (
      groups.find((group) => group.key === selectedKey) ??
      groups.find((group) => group.kind === "brief" && group.injected) ??
      groups.find((group) => group.injected) ??
      groups[0]
    );
  }, [groups, selectedKey]);

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
            第 {chapter.chapter_number} 章 {chapter.title || "未命名"}
          </h1>
          <p>
            {TASK_LABELS[run.task_type] ?? run.task_type} · 第 {run.id} 次调用 ·{" "}
            {formatTime(run.created_at)} · 模型 {run.model}
          </p>
        </div>
        <span className={`run-status ${run.status === "completed" ? "ok" : "warn"}`}>
          {run.status === "completed" ? "已完成" : run.status}
        </span>
        <button
          type="button"
          className="run-button secondary"
          onClick={() => copyText(run.input_summary, "注入清单 ")}
        >
          复制注入清单
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
                    <span>#</span><span>层</span><span>资料</span><span>内容</span>
                    <span>字数</span><span>说明</span>
                  </div>
                  {/* One table. The layer is a column beside the row it
                      describes, not a heading that splits the list. */}
                  <div className="manifest-list">
                    {groups.map((group, index) => {
                      const file = fileNameOfKind(group.kind);
                      const sections = group.blocks.map((block) => sectionNameOf(block.label));
                      return (
                        <button
                          key={group.key}
                          type="button"
                          className={`manifest-row ${
                            group.injected === 0 ? "dropped" : ""
                          } ${selectedGroup?.key === group.key ? "selected" : ""}`}
                          onClick={() => setSelectedKey(group.key)}
                        >
                          <span className="index">{index + 1}</span>
                          <span className="layer">{group.layer}</span>
                          <span className="kind">{KIND_LABELS[group.kind] ?? group.kind}</span>
                          <span className="source">
                            <strong>{file ?? group.blocks[0].label}</strong>
                            {group.blocks.length > 1 ? (
                              /* 小节名直接摊在行里：不用点也知道这份文件交了哪几节 */
                              <span className="manifest-sections">{sections.join("、")}</span>
                            ) : null}
                          </span>
                          <span className="chars tabular">
                            {group.blocks.length > 1 ? `${group.chars} / ${group.blocks.length} 节` : group.chars}
                          </span>
                          <span className="reason">{deliveryText(group)}</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedGroup ? (
                    <div className="manifest-detail">
                      {/* 文件名、几节、合计字数、交付状态——整块只在这里说一次（批注 2） */}
                      <div className="manifest-detail-head">
                        <strong>
                          {fileNameOfKind(selectedGroup.kind) ?? selectedGroup.blocks[0].label}
                        </strong>
                        <span className="tabular">
                          {selectedGroup.blocks.length > 1
                            ? `${selectedGroup.blocks.length} 节 · ${selectedGroup.chars} 字`
                            : `${selectedGroup.chars} 字`}
                        </span>
                        <span className={selectedGroup.injected === 0 ? "undelivered" : ""}>
                          {deliveryText(selectedGroup)}
                        </span>
                        {selectedGroup.injected > 0 ? (
                          <span className="manifest-detail-hint">
                            以下就是模型当时读到的内容
                          </span>
                        ) : null}
                      </div>
                      {selectedGroup.blocks.map((block, index) => (
                        <ManifestSection
                          key={`${block.ref}-${index}`}
                          name={sectionNameOf(block.label)}
                          block={block}
                          showName={selectedGroup.blocks.length > 1}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="run-detail-empty compact">
                  <p>这是一条旧格式记录，没有结构化注入清单</p>
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
                <pre>{run.output || "这次调用没有保存模型输出"}</pre>
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
                  <p>没有发现问题</p>
                )}
                <p className="run-check-note">
                  校验按当前正文与 D 简报的必要事实现算；匹配是字面的 -
                  简报里那条事实要能在正文里逐字找到，所以填关键词而不是整句
                </p>
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
                )) : <p className="empty">这一章还没有审稿记录</p>}
              </div>
            )}
          </div>
        </section>

        <aside className="run-detail-aside">
          <section className="run-side-card">
            <h2>本次调用</h2>
            <dl>
              <div><dt>模型</dt><dd>{run.model}</dd></div>
              <div><dt>任务</dt><dd>{TASK_LABELS[run.task_type] ?? run.task_type}</dd></div>
              <div><dt>开始时间</dt><dd>{formatTime(run.created_at)}</dd></div>
              <div><dt>耗时</dt><dd>未记录</dd></div>
              <div><dt>上下文预算</dt><dd>{manifest ? `${manifest.budget} 字` : "—"}</dd></div>
              <div><dt>执行状态</dt><dd>{run.status === "completed" ? "成功" : run.status}</dd></div>
            </dl>
          </section>

          <section className="run-side-card">
            <h2>这次生成的对象</h2>
            <dl>
              <div><dt>作品</dt><dd>{novel?.title ?? "未知"}</dd></div>
              <div><dt>章节</dt><dd>第 {chapter.chapter_number} 章</dd></div>
              <div><dt>依据的简报</dt><dd>{brief ? `第 ${chapter.chapter_number} 章简报` : "未关联"}</dd></div>
              <div><dt>写入的文件</dt><dd>chapters/{String(chapter.chapter_number).padStart(4, "0")}/draft.md</dd></div>
              <div>
                <dt>相邻调用</dt>
                <dd>
                  {runIndex > 0 ? `上一次第 ${runs[runIndex - 1].id} 回` : "没有上一次"}
                  {runIndex >= 0 && runIndex < runs.length - 1
                    ? ` · 下一次第 ${runs[runIndex + 1].id} 回`
                    : ""}
                </dd>
              </div>
            </dl>
          </section>

          <section className="run-side-card">
            <h2>下一步</h2>
            <button
              type="button"
              className="run-button ghost full"
              disabled={Boolean(chapter.content.trim())}
              title={
                chapter.content.trim()
                  ? "已有正文，先打回才能重写，避免直接覆盖"
                  : "按同一份简报再生成一次"
              }
              onClick={() => void retryRun()}
            >
              <RefreshCcw size={13} /> 重新生成本章
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
