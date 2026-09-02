import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  CornerDownLeft,
  Gauge,
  Paperclip,
  RotateCcw,
  Square,
} from "lucide-react";

import { api } from "../api";
import ProposalCard from "./ProposalCard";
import { useFiles } from "../store/files";
import type {
  ChatContextItem,
  ChatMode,
  ChatReference,
  ChatStreamEvent,
  FileProposal,
  StoredChatMessage,
} from "../types";
import { useWorkbench } from "../store/workbench";

type CommandStatus = "running" | "done" | "failed";

type AgentMeta = {
  model?: string;
  tokenInput?: number;
  tokenOutput?: number;
  refs?: ChatReference[];
  unknown?: string[];
};

type AgentRow = {
  kind: "agent";
  id: number;
  text: string;
  status: "streaming" | "done" | "error";
  question: string;
  meta: AgentMeta;
  error?: string;
  proposals?: FileProposal[];
};

type Row =
  | { kind: "user"; id: number; text: string }
  | AgentRow
  | {
      kind: "command";
      id: number;
      command: string;
      status: CommandStatus;
      detail: string;
      startedAt: number;
    };

const commands = [
  { name: "/generate", args: "", desc: "按当前 D 简报生成正文" },
  { name: "/review", args: "", desc: "AI 七维自检当前章节" },
  { name: "/check", args: "", desc: "机械校验（字数/必要事实）" },
  { name: "/summary", args: "", desc: "章摘要与事实落库" },
  { name: "/save", args: "", desc: "保存当前正文" },
  { name: "/plan", args: "A|B|C|D", desc: "切计划模式并盘点该层规划" },
  { name: "/feedback", args: "<文本>", desc: "写入剧情反馈时间线" },
] as const;

const PLAN_LAYERS: Record<string, { label: string; mention: string }> = {
  A: { label: "A 全书蓝图", mention: "@蓝图" },
  B: { label: "B 目录", mention: "@目录" },
  C: { label: "C 剧情弧", mention: "@弧" },
  D: { label: "D 章节简报", mention: "@简报" },
};

const GREETING =
  "我是这本书的写作 Agent。自然语言直接说就行，我会按相关度自动取用蓝图、目录、设定、人物、伏笔与章摘要；" +
  "用 @ 可以点名某份资料，斜杠命令走流水线：/generate /review /check /summary /save /plan /feedback。";

// Local rows start above any plausible server id, so history rows and
// in-flight rows can never collide when patched by id.
let nextId = 1_000_000;

let nextProposalId = 1;

function tokens(input?: number, output?: number) {
  if (!input && !output) return null;
  const short = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`);
  return `${short(input ?? 0)} in · ${short(output ?? 0)} out`;
}

function fromHistory(rows: StoredChatMessage[]): Row[] {
  return rows.map((row) =>
    row.role === "user"
      ? { kind: "user", id: row.id, text: row.content }
      : {
          kind: "agent",
          id: row.id,
          text: row.content,
          status: "done" as const,
          question: "",
          meta: {
            model: row.model,
            tokenInput: row.token_input,
            tokenOutput: row.token_output,
            refs: row.context_refs,
          },
        },
  );
}

export default function ChatPane({ className = "" }: { className?: string }) {
  const selectedNovelId = useWorkbench((s) => s.selectedNovelId);
  const selectedChapterId = useWorkbench((s) => s.selectedChapterId);
  const llmStatus = useWorkbench((s) => s.llmStatus);
  const busy = useWorkbench((s) => s.busy);
  const setTab = useWorkbench((s) => s.setTab);
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("write");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ChatContextItem[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const pendingFiles = useFiles((store) => store.pending);
  const offerFile = useFiles((store) => store.offer);
  const discardFile = useFiles((store) => store.discardProposal);
  const openFile = useFiles((store) => store.open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running =
    streaming ||
    rows.some((row) => row.kind === "command" && row.status === "running");

  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight });
    } else if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [rows]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setModelMenuOpen(false);
    }
    function onClickOutside(event: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClickOutside);
    };
  }, [modelMenuOpen]);

  // Switching books reloads that book's own thread.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setRows([]);
    if (!selectedNovelId) return;
    let cancelled = false;
    api
      .get<StoredChatMessage[]>(`/api/novels/${selectedNovelId}/chat/messages`)
      .then(async (history) => {
        if (cancelled) return;
        setRows(fromHistory(history));
        // The server keeps the fence in the stored reply, so a reload puts
        // every still-unapplied review card back on its own message.
        for (const row of history) {
          if (cancelled) return;
          if (row.role !== "assistant" || !row.proposals?.length) continue;
          // A fence naming a retired .yaml path can never be applied again, so
          // restoring it would only hang a dead error card on the thread.
          for (const seed of row.proposals.filter((item) => !item.path.endsWith(".yaml"))) {
            if (cancelled) return;
            await offerFromStream(row.id, seed);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNovelId]);

  // The @mention list is backed by the same retriever the agent uses.
  useEffect(() => {
    if (mentionQuery === null || !selectedNovelId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .listChatContext(selectedNovelId, { q: mentionQuery })
        .then((items) => {
          if (!cancelled) setCandidates(items);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, selectedNovelId]);

  const availableModels = llmStatus?.available_models ?? [];
  const activeModel = selectedModel ?? "默认模型";

  function appendMessage(message: Row) {
    setRows((prev) => [...prev, message]);
  }

  function patchAgent(id: number, patch: Partial<AgentRow>) {
    setRows((prev) =>
      prev.map((row) => (row.kind === "agent" && row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function patchCommand(id: number, patch: Partial<Extract<Row, { kind: "command" }>>) {
    setRows((prev) =>
      prev.map((row) =>
        row.kind === "command" && row.id === id ? { ...row, ...patch } : row,
      ),
    );
  }

  // The stream carries the whole proposed file, so the diff the reader sees is
  // computed against the buffer we just re-read: a stale base shows up as a
  // rejected write rather than a silently wrong picture.
  async function offerFromStream(
    rowId: number,
    data: { path: string; text: string; valid: boolean; error: string | null },
  ) {
    if (!selectedNovelId) return;
    let baseText = "";
    let baseRevision = "";
    try {
      const doc = await api.readFile(selectedNovelId, data.path);
      baseText = doc.text;
      baseRevision = doc.revision;
    } catch {
      // Unknown path: keep the card, but it cannot be applied.
    }
    // Already applied verbatim: offering it again would be a stale card.
    if (baseRevision && baseText === data.text) return;
    const proposal: FileProposal = {
      id: nextProposalId++,
      path: data.path,
      text: data.text,
      valid: data.valid && Boolean(baseRevision),
      error: data.error || (baseRevision ? "" : "\u670d\u52a1\u5668\u4e0a\u6ca1\u6709\u8fd9\u4efd\u6587\u4ef6"),
      baseText,
      baseRevision,
    };
    setRows((prev) =>
      prev.map((row) =>
        row.kind === "agent" && row.id === rowId
          ? { ...row, proposals: [...(row.proposals ?? []), proposal] }
          : row,
      ),
    );
    if (proposal.valid) offerFile(proposal);
  }

  async function applyProposal(path: string) {
    setApplyingPath(path);
    await useFiles.getState().applyProposal(path);
    setApplyingPath(null);
  }

  function applyEvent(id: number, event: ChatStreamEvent) {
    if (event.event === "proposal") {
      void offerFromStream(id, event.data);
      return;
    }
    if (event.event === "context") {
      setRows((prev) =>
        prev.map((row) =>
          row.kind === "agent" && row.id === id
            ? {
                ...row,
                meta: {
                  ...row.meta,
                  refs: event.data.items.map(({ kind, label, ref }) => ({ kind, label, ref })),
                  unknown: event.data.unknown_mentions,
                },
              }
            : row,
        ),
      );
      return;
    }
    if (event.event === "delta") {
      setRows((prev) =>
        prev.map((row) =>
          row.kind === "agent" && row.id === id ? { ...row, text: row.text + event.data.text } : row,
        ),
      );
      return;
    }
    if (event.event === "done") {
      const message = event.data.message;
      setRows((prev) =>
        prev.map((row) =>
          row.kind === "agent" && row.id === id
            ? {
                ...row,
                text: message.content,
                status: "done",
                meta: {
                  model: message.model,
                  tokenInput: message.token_input,
                  tokenOutput: message.token_output,
                  refs: row.meta.refs?.length ? row.meta.refs : message.context_refs,
                  unknown: row.meta.unknown,
                },
              }
            : row,
        ),
      );
      return;
    }
    if (event.event === "error") {
      patchAgent(id, {
        status: "error",
        error: event.data.message || "模型没有返回内容",
        text: event.data.partial || "",
      });
      return;
    }
    // "end" arrives even when the model finished cleanly.
    setRows((prev) =>
      prev.map((row) =>
        row.kind === "agent" && row.id === id && row.status === "streaming"
          ? { ...row, status: "done" }
          : row,
      ),
    );
  }

  async function ask(question: string, replaceId?: number) {
    const text = question.trim();
    if (!text || !selectedNovelId || running) return;
    const agentId = replaceId ?? nextId++;

    if (replaceId === undefined) {
      appendMessage({ kind: "user", id: nextId++, text });
    }
    const fresh: AgentRow = {
      kind: "agent",
      id: agentId,
      text: "",
      status: "streaming",
      question: text,
      meta: {},
    };
    setRows((prev) =>
      replaceId === undefined
        ? [...prev, fresh]
        : prev.map((row) => (row.kind === "agent" && row.id === replaceId ? fresh : row)),
    );

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await api.streamChat(
        selectedNovelId,
        { content: text, mode, chapter_id: selectedChapterId, model: selectedModel },
        (event) => applyEvent(agentId, event),
        controller.signal,
      );
    } catch (cause) {
      patchAgent(agentId, {
        status: "error",
        error: cause instanceof Error ? cause.message : "对话失败",
      });
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setRows((prev) =>
        prev.map((row) =>
          row.kind === "agent" && row.id === agentId && row.status === "streaming"
            ? { ...row, status: row.text ? "done" : "error", error: row.error ?? "响应中断" }
            : row,
        ),
      );
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function runFeedback(rest: string, id: number) {
    if (!selectedNovelId) return;
    if (!rest.trim()) {
      patchCommand(id, { status: "failed", detail: "用法：/feedback 第 40 章节奏太赶，需要一场静戏" });
      return;
    }
    try {
      await api.post(`/api/novels/${selectedNovelId}/feedback`, {
        content: rest.trim(),
        impact_levels: [],
        suggestions: {},
      });
      patchCommand(id, { status: "done", detail: "反馈已写入时间线，等待影响分析" });
      setTab("feedback");
    } catch (cause) {
      patchCommand(id, {
        status: "failed",
        detail: cause instanceof Error ? cause.message : "写入失败",
      });
    }
  }

  function runPlan(rest: string) {
    const layer = (rest.trim().split(/\s+/)[0] ?? "").toUpperCase();
    const target = PLAN_LAYERS[layer];
    if (!target) {
      appendMessage({
        kind: "agent",
        id: nextId++,
        text: "",
        status: "error",
        question: "",
        meta: {},
        error: "用法：/plan A｜B｜C｜D（A 蓝图 / B 目录 / C 剧情弧 / D 简报）",
      });
      return;
    }
    setMode("plan");
    void ask(`请盘点${target.label}当前的缺口与内部冲突，并列出下一步待办清单。${target.mention}`);
  }

  async function runCommand(raw: string) {
    const [name, ...rest] = raw.split(/\s+/);
    const command = commands.find((item) => item.name === name);
    const state = useWorkbench.getState();
    if (!command || !state.selectedNovelId || running) return;
    const argument = rest.join(" ");

    if (command.name === "/plan") {
      runPlan(argument);
      return;
    }

    const id = nextId++;
    appendMessage({
      kind: "command",
      id,
      command: command.name,
      status: "running",
      detail: "执行中",
      startedAt: Date.now(),
    });

    if (command.name === "/feedback") {
      await runFeedback(argument, id);
      return;
    }

    const errorBefore = state.error;
    try {
      if (command.name === "/generate") {
        await state.generateDraft();
        const snapshot = useWorkbench.getState();
        const chapter = snapshot.chapters.find((item) => item.id === snapshot.selectedChapterId);
        if (snapshot.error && snapshot.error !== errorBefore) {
          patchCommand(id, { status: "failed", detail: snapshot.error });
        } else if (chapter) {
          patchCommand(id, {
            status: "done",
            detail: `第 ${chapter.chapter_number} 章《${chapter.title || "未命名"}》· ${chapter.word_count} 字 · 机械校验 ${
              snapshot.machineCheck?.passed ? "通过" : "未通过"
            }`,
          });
        } else {
          patchCommand(id, { status: "failed", detail: "未找到可生成的简报，先在 B 目录或 D 简报里建一章" });
        }
      } else if (command.name === "/review") {
        await state.runAiReview();
        const snapshot = useWorkbench.getState();
        patchCommand(id, {
          status: snapshot.error && snapshot.error !== errorBefore ? "failed" : "done",
          detail: snapshot.error && snapshot.error !== errorBefore ? snapshot.error : "AI 七维自检完成，报告见右栏记录",
        });
      } else if (command.name === "/check") {
        await state.runMachineCheck();
        const snapshot = useWorkbench.getState();
        const check = snapshot.machineCheck;
        patchCommand(id, {
          status: check ? (check.passed ? "done" : "failed") : "failed",
          detail: check
            ? `${check.passed ? "通过" : "未通过"} · ${check.word_count} 字${check.issues.length ? ` · ${check.issues.length} 个问题` : ""}`
            : snapshot.error ?? "校验失败",
        });
      } else if (command.name === "/summary") {
        await state.extractChapterFacts();
        const snapshot = useWorkbench.getState();
        patchCommand(id, {
          status: snapshot.error && snapshot.error !== errorBefore ? "failed" : "done",
          detail: snapshot.error && snapshot.error !== errorBefore ? snapshot.error : "章摘要与事实已写入设定库",
        });
      } else if (command.name === "/save") {
        await state.saveChapter();
        const snapshot = useWorkbench.getState();
        patchCommand(id, {
          status: snapshot.error && snapshot.error !== errorBefore ? "failed" : "done",
          detail: snapshot.error && snapshot.error !== errorBefore ? snapshot.error : "正文已保存",
        });
      }
    } catch (cause) {
      patchCommand(id, {
        status: "failed",
        detail: cause instanceof Error ? cause.message : "执行失败",
      });
    }
  }

  function syncMention(value: string) {
    const match = /@([^\s@]*)$/.exec(value);
    setMentionQuery(match ? match[1] : null);
  }

  function submit() {
    const text = input.trim();
    if (!text || running || !selectedNovelId) return;
    setInput("");
    setMentionQuery(null);
    if (text.startsWith("/")) {
      void runCommand(text);
      return;
    }
    void ask(text);
  }

  function insertMention(item: ChatContextItem) {
    setInput((value) =>
      /@([^\s@]*)$/.test(value)
        ? value.replace(/@([^\s@]*)$/, `${item.mention} `)
        : `${value}${item.mention} `,
    );
    setMentionQuery(null);
  }

  const slashHints = input.startsWith("/") && !busy;
  const [typedName] = input.trim().split(/\s+/);
  const matched = commands.filter((item) => item.name.startsWith(typedName));
  const showMentions = mentionQuery !== null;

  return (
    <section className={`chat-pane ${className}`} aria-label="AI 对话">
      {llmStatus && !llmStatus.configured && (
        <div className="chat-notice">
          LLM 未配置：在 backend/.env 填入密钥后重启后端，模型状态会变绿。
        </div>
      )}
      <div className="chat-messages" ref={scrollRef}>
        {(rows.length ? rows : [{
          kind: "agent" as const,
          id: 0,
          text: GREETING,
          status: "done" as const,
          question: "",
          meta: {},
        }]).map((row) => {
          if (row.kind === "user") {
            return (
              <div key={row.id} className="chat-row user">
                <div className="chat-message">
                  <span className="chat-avatar user" aria-hidden="true">我</span>
                  <div className="chat-bubble">{row.text}</div>
                </div>
              </div>
            );
          }
          if (row.kind === "command") {
            const seconds = row.status === "running" ? elapsed : null;
            return (
              <div key={row.id} className="chat-row assistant">
                <div className="chat-message">
                  <span className="chat-avatar agent" aria-hidden="true">墨</span>
                  <div className={`chat-card command ${row.status}`}>
                    <header>
                      <code>{row.command}</code>
                      <span className="chat-state">
                        {row.status === "running" && <i className="spinner" aria-hidden="true" />}
                        {row.status === "running" ? (
                          <span className="tabular">运行中 {seconds ?? 0}s</span>
                        ) : row.status === "done" ? (
                          "完成"
                        ) : (
                          "失败"
                        )}
                      </span>
                    </header>
                    <p>{row.detail}</p>
                  </div>
                </div>
              </div>
            );
          }
          const usage = tokens(row.meta.tokenInput, row.meta.tokenOutput);
          const refs = row.meta.refs ?? [];
          return (
            <div key={row.id} className="chat-row assistant">
              <div className="chat-message">
                <span className="chat-avatar agent" aria-hidden="true">墨</span>
                <div className={`chat-card agent ${row.status}`}>
                  <header className="chat-card-head">
                    <span className="chat-who">
                      Agent · {mode === "plan" ? "计划模式" : "写作模式"}
                      {row.meta.model ? ` · ${row.meta.model}` : ""}
                    </span>
                    {row.status === "streaming" ? (
                      <span className="chat-state">
                        <i className="spinner" aria-hidden="true" />
                        <span>生成中</span>
                      </span>
                    ) : null}
                  {row.status === "error" ? (
                      <span className="chat-state">回复失败</span>
                    ) : null}
                  </header>
                  <p>
                    {row.text}
                    {row.status === "streaming" && !row.text ? "正在思考…" : null}
                    {row.status === "streaming" ? (
                      <span className="chat-caret" aria-hidden="true" />
                    ) : null}
                  </p>
                  {(row.proposals ?? []).map((item) =>
                    pendingFiles[item.path]?.id === item.id ? (
                      <ProposalCard
                        key={`${item.path}:${item.id}`}
                        proposal={item}
                        applying={applyingPath === item.path}
                        onOpen={() => void openFile(item.path)}
                        onApply={() => void applyProposal(item.path)}
                        onDiscard={() => discardFile(item.path)}
                      />
                    ) : null,
                  )}
                  {row.status === "error" ? (
                    <div className="chat-error">
                      <span>{row.error}</span>
                      {row.question ? (
                        <button
                          type="button"
                          className="chat-retry"
                          onClick={() => void ask(row.question, row.id)}
                        >
                          <RotateCcw size={12} />
                          重试
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {row.status !== "streaming" && (usage || refs.length) ? (
                    <button
                      type="button"
                      className="chat-meta"
                      aria-expanded={expanded === row.id}
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <Gauge size={11} />
                      <span className="tabular">{usage ?? `引用 ${refs.length} 份资料`}</span>
                      <ChevronDown size={11} />
                    </button>
                  ) : null}
                  {expanded === row.id ? (
                    <div className="chat-detail">
                      <p className="chat-detail-line">
                        输入 {row.meta.tokenInput ?? 0} / 输出 {row.meta.tokenOutput ?? 0} tokens
                        {row.meta.model ? ` · ${row.meta.model}` : ""}
                      </p>
                      {refs.length ? (
                        <ul className="chat-refs">
                          {refs.map((ref) => (
                            <li key={`${ref.kind}:${ref.ref}`} title={ref.label}>
                              {ref.label}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="chat-detail-empty">本轮没有检索到资料</p>
                      )}
                      {row.meta.unknown?.length ? (
                        <p className="chat-detail-empty">
                          未识别的 @引用：{row.meta.unknown.join("、")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="chat-context">
        上下文：自动检索 + @点名 · 保留最近 8 条 · Enter 发送 / Shift+Enter 换行
      </p>
      <div className="chat-dock">
        {showMentions ? (
          <ul className="chat-hints mentions" role="listbox" aria-label="引用资料">
            {candidates.length ? (
              candidates.map((item) => (
                <li key={item.ref}>
                  <button type="button" onClick={() => insertMention(item)}>
                    <code>{item.mention}</code>
                    <span title={item.label}>{item.label}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="chat-hints-empty">
                {selectedNovelId ? "没有匹配的资料" : "先在书架选一本书"}
              </li>
            )}
          </ul>
        ) : slashHints && matched.length ? (
          <ul className="chat-hints" role="listbox" aria-label="斜杠命令">
            {matched.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(item.name === "/plan" ? "/plan " : `${item.name} `);
                  }}
                >
                  <code>
                    {item.name}
                    {item.args ? ` ${item.args}` : ""}
                  </code>
                  <span>{item.desc}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="chat-input">
          <textarea
            value={input}
            rows={1}
            placeholder="输入 / 使用命令，@ 引用资料，或直接描述需求…"
            aria-label="对话输入"
            onChange={(event) => {
              setInput(event.target.value);
              syncMention(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && mentionQuery !== null) {
                setMentionQuery(null);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className={`chat-send ${running ? "danger" : "primary"}`}
            disabled={!running && !input.trim()}
            onClick={() => {
              if (running) {
                stop();
                return;
              }
              submit();
            }}
            aria-label={running ? "停止生成" : "发送"}
          >
            {running ? <Square size={14} /> : <CornerDownLeft size={14} />}
          </button>
        </div>
        <div className="chat-toolbar">
          <div className="mode-switch" role="radiogroup" aria-label="对话模式">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "plan"}
              className={mode === "plan" ? "selected" : ""}
              onClick={() => setMode("plan")}
            >
              计划
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "write"}
              className={mode === "write" ? "selected" : ""}
              onClick={() => setMode("write")}
            >
              写作
            </button>
          </div>
          <button
            type="button"
            className={`chat-attach ${mentionQuery !== null ? "active" : ""}`}
            aria-label="添加引用资料"
            aria-expanded={mentionQuery !== null}
            onClick={() => {
              if (mentionQuery !== null) {
                setMentionQuery(null);
                return;
              }
              setInput((value) => (/@([^\s@]*)$/.test(value) ? value : `${value}@`));
              setMentionQuery("");
            }}
          >
            <Paperclip size={15} />
          </button>
          <span className="spacer" />
          <div className="model-menu-wrap" ref={modelMenuRef}>
            <button
              type="button"
              className="model-pill"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              aria-expanded={modelMenuOpen}
              aria-haspopup="listbox"
            >
              {activeModel}
              <ChevronDown size={12} />
            </button>
            {modelMenuOpen ? (
              <div className="model-menu" role="listbox" aria-label="选择模型">
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedModel === null}
                  className={`model-menu-item ${selectedModel === null ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedModel(null);
                    setModelMenuOpen(false);
                  }}
                >
                  默认（后端 NOVEL_LLM_CHAT_MODEL）
                </button>
                {availableModels.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={activeModel === name}
                    className={`model-menu-item ${activeModel === name ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedModel(name);
                      setModelMenuOpen(false);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
