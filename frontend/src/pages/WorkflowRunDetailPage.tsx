import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import { PURPOSE_LABELS } from "../labels";
import { formatTime } from "../utils/time";
import type {
  Novel,
  WorkflowNodeRun,
  WorkflowRunDetail,
} from "../types";

const NODE_TYPE_LABELS: Record<string, string> = {
  start: "输入",
  context: "资料注入",
  prompt: "提示词",
  condition: "条件分流",
  model: "模型调用",
  output: "结果",
};

type ContextItem = {
  key?: string;
  source?: string;
  title?: string;
  reason?: string;
  estimated_tokens?: number;
};

type ReviewIssue = {
  category?: string;
  severity?: string;
  quote?: string;
  suggestion?: string;
  reason?: string;
};

function durationText(start?: string | null, end?: string | null): string {
  if (!start || !end) return "未记录";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(2)} 秒` : "未记录";
}

const statusText = (status: string): string =>
  status === "completed" ? "已完成" : status === "failed" ? "失败" : status;

/** 一个节点折叠起来的标题行：所有节点共用，节点内部只画自己的差异。 */
function NodeShell({ node }: { node: WorkflowNodeRun }) {
  return (
    <summary>
      <strong className="wf-node-title">{NODE_TYPE_LABELS[node.node_type] ?? node.node_type}</strong>
      <span className="wf-node-id">{node.node_id}</span>
      <span className={`run-status ${node.status === "completed" ? "ok" : "warn"}`}>
        {statusText(node.status)}
      </span>
      <span className="wf-node-meta tabular">
        {node.token_input} / {node.token_output} token · {durationText(node.started_at, node.ended_at)}
      </span>
    </summary>
  );
}

function ContextBody({ output }: { output: Record<string, unknown> }) {
  const selected = (output.selected as ContextItem[] | undefined) ?? [];
  const excluded = (output.excluded as ContextItem[] | undefined) ?? [];
  const missing = (output.missing_characters as string[] | undefined) ?? [];
  return (
    <div className="wf-node-body">
      <p className="wf-node-line">
        预算 <strong className="tabular">{String(output.token_budget ?? "—")}</strong> ·
        估算 <strong className="tabular">{String(output.estimated_tokens ?? "—")}</strong> ·
        已注入 <strong className="tabular">{selected.length}</strong> 项 · 未注入{" "}
        <strong className="tabular">{excluded.length}</strong> 项
      </p>
      {missing.length ? (
        <p className="wf-node-line">
          <strong>未命中人物：</strong>
          {missing.join("、")}
        </p>
      ) : null}
      <h4>已注入</h4>
      {selected.length ? (
        <ul>
          {selected.map((item, index) => (
            <li key={`${item.key ?? index}`}>
              {item.title ?? item.key ?? `资料 ${index + 1}`}
              {item.estimated_tokens ? <span className="tabular"> · {item.estimated_tokens} token</span> : null}
              {item.reason ? <span className="wf-node-muted"> · {item.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-node-muted">这次没有注入任何资料</p>
      )}
      <h4>未注入（原因）</h4>
      {excluded.length ? (
        <ul>
          {excluded.map((item, index) => (
            <li key={`${item.key ?? index}`}>
              {item.title ?? item.key ?? `资料 ${index + 1}`}
              <span className="wf-node-muted"> · {item.reason || "未说明原因"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-node-muted">没有资料被排除</p>
      )}
    </div>
  );
}

function ModelBody({ output }: { output: Record<string, unknown> }) {
  return (
    <div className="wf-node-body">
      <p className="wf-node-line">
        模型 <strong>{String(output.model ?? "—")}</strong> · 输入{" "}
        <strong className="tabular">{String(output.token_input ?? 0)}</strong> · 输出{" "}
        <strong className="tabular">{String(output.token_output ?? 0)}</strong>
      </p>
      <h4>模型输出</h4>
      <pre className="wf-node-pre">{String(output.text ?? "")}</pre>
    </div>
  );
}

function OutputBody({ output }: { output: Record<string, unknown> }) {
  const issues = (output.issues as ReviewIssue[] | undefined) ?? [];
  if (issues.length) {
    return (
      <div className="wf-node-body">
        <h4>自检问题（{issues.length}）</h4>
        <ul className="wf-review-issues">
          {issues.map((issue, index) => (
            <li key={`${issue.quote ?? index}`}>
              <strong>{issue.category ?? "问题"} · {issue.severity ?? "medium"}</strong>
              {issue.quote ? <blockquote>{issue.quote}</blockquote> : null}
              {issue.suggestion ? <p>建议：{issue.suggestion}</p> : null}
              {issue.reason ? <p className="wf-node-muted">原因：{issue.reason}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const text = typeof output.text === "string" ? output.text : "";
  return (
    <div className="wf-node-body">
      {text ? <pre className="wf-node-pre">{text}</pre> : <p className="wf-node-muted">这次运行没有结果正文</p>}
    </div>
  );
}

function NodeBody({ node }: { node: WorkflowNodeRun }) {
  if (node.node_type === "context") return <ContextBody output={node.output} />;
  if (node.node_type === "model") return <ModelBody output={node.output} />;
  if (node.node_type === "output") return <OutputBody output={node.output} />;
  if (node.node_type === "prompt") {
    return (
      <div className="wf-node-body">
        <pre className="wf-node-pre">{String(node.output.text ?? "")}</pre>
      </div>
    );
  }
  return null;
}

export default function WorkflowRunDetailPage() {
  const navigate = useNavigate();
  const params = useParams();
  const novelId = Number(params.novelId);
  const chapterId = Number(params.chapterId);
  const runId = Number(params.runId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);

  useEffect(() => {
    if (!Number.isFinite(novelId) || !Number.isFinite(chapterId) || !Number.isFinite(runId)) {
      setError("运行链接不完整");
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const [novels, detail] = await Promise.all([
          api.get<Novel[]>("/api/novels"),
          api.get<WorkflowRunDetail>(`/api/workflow-runs/${runId}`),
        ]);
        if (detail.chapter && detail.chapter.id !== chapterId) {
          throw new Error("这次运行不属于当前章节");
        }
        if (!cancelled) {
          setNovel(novels.find((item) => item.id === novelId) ?? null);
          setRun(detail);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "运行详情加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chapterId, novelId, runId]);

  const modelNodes = useMemo(
    () => (run ? run.nodes.filter((node) => node.node_type === "model") : []),
    [run],
  );
  const modelTokens = useMemo(
    () => modelNodes.reduce(
      (total, node) => ({
        input: total.input + node.token_input,
        output: total.output + node.token_output,
      }),
      { input: 0, output: 0 },
    ),
    [modelNodes],
  );

  if (loading) {
    return (
      <main className="run-detail-page" aria-label="运行详情">
        <div className="run-detail-empty">运行详情加载中…</div>
      </main>
    );
  }

  if (error || !run || (run.chapter && run.chapter.id !== chapterId)) {
    return (
      <main className="run-detail-page" aria-label="运行详情">
        <div className="run-detail-empty">
          <FileText size={24} aria-hidden="true" />
          <h1>运行详情不可用</h1>
          <p>{error ?? "没有找到这次运行"}</p>
          <button type="button" className="run-button secondary" onClick={() => navigate(-1)}>
            返回
          </button>
        </div>
      </main>
    );
  }

  const chapter = run.chapter;
  const purpose = PURPOSE_LABELS[run.workflow.purpose] ?? run.workflow.purpose ?? "运行";
  const tokensMatch = modelTokens.input === run.token_input && modelTokens.output === run.token_output;

  return (
    <main className="run-detail-page" aria-label="Workflow 运行详情">
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
            {chapter ? `第 ${chapter.chapter_number} 章 ${chapter.title || "未命名"}` : "Workflow 运行"}
          </h1>
          <p>
            {run.workflow.name || "Workflow"} v{run.version.version ?? "—"} · {purpose} · 运行 #
            {run.id} · {formatTime(run.created_at)}
          </p>
        </div>
        <span className={`run-status ${run.status === "completed" ? "ok" : "warn"}`}>
          {statusText(run.status)}
        </span>
      </header>

      <section className="run-kpis" aria-label="本次运行成本">
        <article><span>输入 token</span><strong className="tabular">{run.token_input}</strong><small>各模型节点之和</small></article>
        <article><span>输出 token</span><strong className="tabular">{run.token_output}</strong><small>各模型节点之和</small></article>
        <article><span>节点</span><strong className="tabular">{run.nodes.length}</strong><small>已落库的执行步</small></article>
        <article><span>模型</span><strong>{modelNodes[0] ? String(modelNodes[0].output.model ?? "—") : "未调用"}</strong><small>本次运行</small></article>
        <article><span>耗时</span><strong>{durationText(run.started_at, run.ended_at)}</strong><small>开始到结束</small></article>
      </section>

      <div className="run-detail-body">
        <section className="run-detail-main" aria-label="节点与结果">
          <div className="run-detail-card">
            <div className="run-detail-card-head">
              <h2>执行节点</h2>
              <span className={`run-status ${tokensMatch ? "ok" : "warn"}`}>
                {tokensMatch ? "模型节点合计 = 运行总计" : "模型节点合计与总计不一致"}
              </span>
            </div>
            <div className="wf-nodes">
              {run.nodes.map((node) => (
                <details key={node.id} className="wf-node" open={node.node_type === "context"}>
                  <NodeShell node={node} />
                  <NodeBody node={node} />
                  {node.error ? <p className="wf-node-error">{node.error}</p> : null}
                </details>
              ))}
              {run.error ? <p className="wf-node-error">{run.error}</p> : null}
            </div>
          </div>
        </section>

        <aside className="run-detail-aside">
          <section className="run-side-card">
            <h2>本次运行</h2>
            <dl>
              <div><dt>作品</dt><dd>{novel?.title ?? "未知"}</dd></div>
              <div><dt>Workflow</dt><dd>{run.workflow.name || "—"}</dd></div>
              <div><dt>版本</dt><dd>v{run.version.version ?? "—"}</dd></div>
              <div><dt>用途</dt><dd>{purpose}</dd></div>
              <div><dt>执行状态</dt><dd>{statusText(run.status)}</dd></div>
              <div><dt>模型节点</dt><dd className="tabular">{modelNodes.length} 个</dd></div>
              <div><dt>合计校验</dt><dd>{tokensMatch ? "一致" : "不一致"}</dd></div>
            </dl>
          </section>

          <section className="run-side-card">
            <h2>写入与关联</h2>
            <dl>
              <div><dt>候选</dt><dd>{run.job ? `#${run.job.id} · ${run.job.status}` : "未关联"}</dd></div>
              <div>
                <dt>写入操作</dt>
                <dd>
                  {run.accept_operation
                    ? `${run.accept_operation.path} · rev ${run.accept_operation.revision.slice(0, 8)}`
                    : "尚未接受写入"}
                </dd>
              </div>
              <div>
                <dt>审核</dt>
                <dd>
                  {run.reviews.length
                    ? run.reviews.map((review) => `${review.reviewer === "ai" ? "AI" : "人工"} · ${review.decision}`).join(" / ")
                    : "未关联"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
