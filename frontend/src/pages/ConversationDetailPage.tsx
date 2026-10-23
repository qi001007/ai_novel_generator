import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import MarkdownText from "../components/MarkdownText";
import { Button, FloatingWindow, TextField } from "../components/ui";
import type { ChatConversation, StoredChatMessage } from "../types";
import { formatTime } from "../utils/time";

const PREVIEW_LIMIT = 280;

/** Plain-text excerpt that keeps blank-line paragraph breaks, so a folded answer
    still reads as prose instead of one dense block. */
function previewText(content: string): string {
  return content
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !/^\s*[-*_]{3,}\s*$/.test(line) && (line.match(/\|/g)?.length ?? 0) < 2)
        .map((line) => line.replace(/^#{1,4}\s+/, "").replace(/^>\s?/, "").replace(/^[-*+]\s+/, ""))
        .join(" ")
        .replace(/[#>*`]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

function roleLabel(message: StoredChatMessage): string {
  if (message.role === "user") return "主人";
  if (message.role === "command") return message.command_state?.command ?? "命令";
  return "AI";
}

function bodyText(message: StoredChatMessage): string {
  if (message.content) return message.content;
  return message.role === "command" ? message.command_state?.command ?? "" : "";
}

export default function ConversationDetailPage() {
  const navigate = useNavigate();
  const { novelId: novelIdParam, conversationId: conversationIdParam } = useParams();
  const novelId = Number(novelIdParam);
  const conversationId = Number(conversationIdParam);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<StoredChatMessage | null>(null);

  useEffect(() => {
    if (!Number.isFinite(novelId) || !Number.isFinite(conversationId)) return;
    let active = true;
    setLoading(true);
    Promise.all([
      api.get<StoredChatMessage[]>(`/api/novels/${novelId}/chat/messages?conversation=${conversationId}`),
      api.get<ChatConversation[]>(`/api/novels/${novelId}/chat/conversations`),
    ])
      .then(([rows, threads]) => {
        if (!active) return;
        setMessages(rows);
        setConversations(threads);
        setError(null);
      })
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [novelId, conversationId]);

  const conversation = conversations.find((item) => item.conversation_id === conversationId) ?? null;
  const totals = useMemo(() => {
    const answers = messages.filter((item) => item.role === "assistant");
    return {
      answers: answers.length,
      input: answers.reduce((sum, item) => sum + (item.token_input || 0), 0),
      output: answers.reduce((sum, item) => sum + (item.token_output || 0), 0),
      steps: answers.reduce((sum, item) => sum + (item.steps?.length ?? 0), 0),
      models: [...new Set(answers.map((item) => item.model).filter(Boolean))],
    };
  }, [messages]);

  const shownMessages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((message) => {
      const command = message.command_state?.command ?? "";
      return `${message.content} ${message.model} ${message.role} ${command}`.toLowerCase().includes(needle);
    });
  }, [messages, query]);

  return (
    <main className="run-detail-page conversation-detail-page" aria-label="对话详情">
      <header className="run-detail-topbar">
        <button type="button" className="icon-button" aria-label="返回工作台" onClick={() => navigate(`/novels/${novelId}`)}>
          <ArrowLeft size={16} />
        </button>
        <div className="run-detail-heading">
          <h1>{conversation?.first_question || `对话 #${conversationId}`}</h1>
          <p>{messages.length} 条消息 · {conversation ? formatTime(conversation.updated_at) : ""}</p>
        </div>
        <span className="run-status ok">对话</span>
      </header>

      <div className="conversation-search-bar">
        <label className="worldview-search"><Search size={13} /><TextField type="search" aria-label="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题或回答" /></label>
        <span>{shownMessages.length} / {messages.length}</span>
      </div>

      {error ? <p className="status-error">{error}</p> : null}
      {loading ? <p className="run-detail-empty">对话详情加载中…</p> : null}

      {!loading ? (
        <>
          <section className="run-kpis" aria-label="对话消耗">
            <article><span>回答数</span><strong className="tabular">{totals.answers}</strong><small>模型回复</small></article>
            <article><span>输入 token</span><strong className="tabular">{totals.input}</strong><small>累计</small></article>
            <article><span>输出 token</span><strong className="tabular">{totals.output}</strong><small>累计</small></article>
            <article><span>工具步骤</span><strong className="tabular">{totals.steps}</strong><small>含读取与命令</small></article>
            <article><span>模型</span><strong>{totals.models.join(" / ") || "—"}</strong><small>本次对话使用</small></article>
          </section>

          <div className="run-detail-body">
            <section className="run-detail-main" aria-label="对话消息">
              <div className="run-detail-card">
                <div className="run-detail-card-head"><h2>消息</h2><span>按时间顺序</span></div>
                <ol className="conversation-detail-list">
                  {shownMessages.map((message) => {
                    const content = bodyText(message);
                    const preview = previewText(content);
                    const truncated = preview.length > PREVIEW_LIMIT;
                    return <li key={message.id} className={`conversation-detail-message is-${message.role}`}>
                      <header>
                        <span className="conversation-role">{roleLabel(message)}</span>
                        {message.role === "assistant" && message.model ? <span>{message.model}</span> : null}
                        {message.role === "assistant" ? <span className="tabular">{message.token_input} / {message.token_output} token</span> : null}
                        <time>{formatTime(message.created_at)}</time>
                      </header>
                      {message.role === "assistant" && !truncated
                        ? <MarkdownText text={content} />
                        : <p className="conversation-preview">{truncated ? `${preview.slice(0, PREVIEW_LIMIT)}…` : content}</p>}
                      {truncated || message.steps?.length ? (
                        <footer className="conversation-message-actions">
                          {truncated ? <Button compact onClick={() => setDetail(message)}>查看全文</Button> : null}
                          {message.steps?.length ? <small>{message.steps.length} 个工具步骤</small> : null}
                        </footer>
                      ) : null}
                    </li>;
                  })}
                  {shownMessages.length === 0 ? <li className="empty-records">没有匹配的消息</li> : null}
                </ol>
              </div>
            </section>
          </div>

          {detail ? (
            <FloatingWindow
              title={`${roleLabel(detail)} · 全文`}
              onClose={() => setDetail(null)}
              width={Math.min(760, Math.max(320, window.innerWidth - 32))}
              height={Math.min(600, Math.max(280, window.innerHeight - 48))}
            >
              <article className="conversation-detail-full" aria-label="消息全文">
                <header>
                  <span className="conversation-role">{roleLabel(detail)}</span>
                  {detail.role === "assistant" && detail.model ? <span>{detail.model}</span> : null}
                  {detail.role === "assistant" ? <span className="tabular">{detail.token_input} / {detail.token_output} token</span> : null}
                  <time>{formatTime(detail.created_at)}</time>
                </header>
                {detail.role === "assistant" ? <MarkdownText text={bodyText(detail)} /> : <p>{bodyText(detail)}</p>}
                {detail.steps?.length ? <small>{detail.steps.length} 个工具步骤</small> : null}
              </article>
            </FloatingWindow>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
