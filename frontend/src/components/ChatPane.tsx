import { useEffect, useRef, useState } from "react";
import { ChevronDown, CornerDownLeft, Paperclip, Square } from "lucide-react";

import { useWorkbench } from "../store/workbench";

type CommandStatus = "running" | "done" | "failed";

type ChatMessage =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string }
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
] as const;

let nextId = 1;

export default function ChatPane() {
  const selectedNovelId = useWorkbench((s) => s.selectedNovelId);
  const llmStatus = useWorkbench((s) => s.llmStatus);
  const busy = useWorkbench((s) => s.busy);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      kind: "assistant",
      id: nextId++,
      text: "我是这本书的写作工作台。用斜杠命令驱动流水线：/generate 生成正文、/review 七维自检、/check 机械校验、/summary 事实落库、/save 保存。自然语言对话 Agent 会在 C5 接入。",
    },
  ]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"plan" | "write">("write");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const running = messages.some(
    (message) => message.kind === "command" && message.status === "running",
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight });
    } else if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

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

  const availableModels = llmStatus?.configured && llmStatus.models
    ? Object.entries(llmStatus.models).filter(([, available]) => available).map(([name]) => name)
    : [];
  const activeModel = selectedModel ?? llmStatus?.provider ?? "未配置模型";

  function appendMessage(message: ChatMessage) {
    setMessages((prev) => [...prev, message]);
  }

  function patchCommand(id: number, patch: Partial<Extract<ChatMessage, { kind: "command" }>>) {
    setMessages((prev) =>
      prev.map((message) =>
        message.kind === "command" && message.id === id ? { ...message, ...patch } : message,
      ),
    );
  }

  async function runCommand(raw: string) {
    const command = commands.find((item) => item.name === raw);
    const state = useWorkbench.getState();
    if (!command || !selectedNovelId || running) return;

    const id = nextId++;
    appendMessage({
      kind: "command",
      id,
      command: command.name,
      status: "running",
      detail: "执行中",
      startedAt: Date.now(),
    });

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

  function submit() {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    appendMessage({ kind: "user", id: nextId++, text });
    if (text.startsWith("/")) {
      void runCommand(text.split(/\s+/)[0]);
      return;
    }
    appendMessage({
      kind: "assistant",
      id: nextId++,
      text: "自然语言指令需要 C5 的对话 Agent（NOVEL_LLM_CHAT_MODEL）。现在可以直接用：/generate /review /check /summary /save。",
    });
  }

  const showHints = input.startsWith("/") && !busy;
  const matched = commands.filter((item) => item.name.startsWith(input.trim()));

  return (
    <section className="chat-pane" aria-label="AI 对话">
      {llmStatus && !llmStatus.configured && (
        <div className="chat-notice">
          LLM 未配置：在 backend/.env 填入密钥后重启后端，模型状态会变绿。
        </div>
      )}
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((message) => {
          if (message.kind === "user") {
            return (
              <div key={message.id} className="chat-row user">
                <div className="chat-message">
                  <span className="chat-avatar user" aria-hidden="true">我</span>
                  <div className="chat-bubble">{message.text}</div>
                </div>
              </div>
            );
          }
          if (message.kind === "assistant") {
            return (
              <div key={message.id} className="chat-row assistant">
              <div className="chat-message">
                <span className="chat-avatar agent" aria-hidden="true">墨</span>
                <div className="chat-card agent">
                  <span className="chat-who">Agent · {mode === "plan" ? "计划模式" : "写作模式"}</span>
                  <p>{message.text}</p>
                </div>
              </div>
              </div>
            );
          }
          const seconds = message.status === "running" ? elapsed : null;
          return (
            <div key={message.id} className="chat-row assistant">
            <div className="chat-message">
              <span className="chat-avatar agent" aria-hidden="true">墨</span>
              <div className={`chat-card command ${message.status}`}>
                <header>
                  <code>{message.command}</code>
                  <span className="chat-state">
                    {message.status === "running" && <i className="spinner" aria-hidden="true" />}
                    {message.status === "running" ? (
                      <span className="tabular">运行中 {seconds ?? 0}s</span>
                    ) : message.status === "done" ? (
                      "完成"
                    ) : (
                      "失败"
                    )}
                  </span>
                </header>
                <p>{message.detail}</p>
              </div>
            </div>
            </div>
          );
        })}
      </div>
      <div className="chat-dock">
        {showHints && matched.length > 0 && (
          <ul className="chat-hints" role="listbox">
            {matched.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(item.name);
                  }}
                >
                  <code>{item.name}</code>
                  <span>{item.desc}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
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
          <button type="button" className="icon-button" aria-label="添加参考资料（C5 接入）" disabled>
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
                {availableModels.length > 0 ? (
                  availableModels.map((name) => (
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
                  ))
                ) : (
                  <p className="model-menu-empty">
                    在 backend/.env 配置 NOVEL_LLM_* 后可选模型
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="chat-input">
          <textarea
            value={input}
            rows={1}
            placeholder="输入 / 使用命令，或直接描述需求…"
            aria-label="对话输入"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className={running ? "danger" : "primary"}
            disabled={!running && !input.trim()}
            onClick={() => {
              if (running) return;
              submit();
            }}
            aria-label={running ? "运行中" : "发送"}
          >
            {running ? <Square size={14} /> : <CornerDownLeft size={14} />}
          </button>
        </div>
        <p className="chat-context">上下文：当前章节 + D 简报 · Enter 发送 / Shift+Enter 换行</p>
      </div>
    </section>
  );
}
