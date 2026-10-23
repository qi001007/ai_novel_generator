import { useEffect, useRef, useState } from "react";

import {
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  Wrench,
  CornerDownLeft,
  Copy,
  Download,
  FileText,
  Search,
  ArrowDown,
  Gauge,
  Paperclip,
  RotateCcw,
  ScrollText,
  Square,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { Button, IconButton } from "./ui";
import MarkdownText from "./MarkdownText";
import { compressRefs } from "../contextLayers";
import { ACTION_LABELS, reasoningParagraphs, splitTrace, stripProposalFences, traceActions } from "./chatTrace";
import ProposalCard from "./ProposalCard";
import { briefPath, draftChapter, draftDocument, useFiles } from "../store/files";
import type { ChatContextItem, ChatMode, ChatStreamEvent, Chapter, FileProposal, ChatAttachment, StoredChatMessage } from "../types";
import { findBriefForChapter, useWorkbench } from "../store/workbench";
import {
  applyStreamEvent,
  applyAgentRunState,
  approvalFromStep,
  attachProposal,
  patchAgent as patchRows,
  patchCommand as patchCommandRows,
  toolLine,
  type AgentRow,
  type Row,
} from "./chatRows";
import { modeLabel } from "../labels";

const commands = [
  { name: "/generate", args: "<章节序号>", desc: "生成该章正文；不写序号就是当前选中章" },
  { name: "/review", args: "", desc: "AI 七维自检当前章节" },
  { name: "/check", args: "", desc: "错别字检查" },
  { name: "/summary", args: "", desc: "章摘要与事实落库" },
  { name: "/save", args: "", desc: "保存当前正文" },
  { name: "/plan", args: "A|B|C|D", desc: "切计划模式并盘点该层规划" },
  { name: "/feedback", args: "<文本>", desc: "写入剧情反馈时间线" },
  { name: "/search", args: "<词>", desc: "联网查证本书以外的资料" },
] as const;

const PLAN_LAYERS: Record<string, { label: string; mention: string }> = {
  A: { label: "A 全书蓝图", mention: "@蓝图" },
  B: { label: "B 目录", mention: "@目录" },
  C: { label: "C 剧情弧", mention: "@弧" },
  D: { label: "D 章节简报", mention: "@简报" },
};

// 批注 35.30：这一串原先算出来就丢掉，`/generate 3` 实际生成的还是碰巧选中的那一章。
function chapterByArgument(argument: string, chapters: Chapter[]): Chapter | null {
  const number = Number(argument);
  if (!argument || !Number.isInteger(number)) return null;
  return chapters.find((item) => item.chapter_number === number) ?? null;
}

function unmatchedChapter(argument: string, chapters: Chapter[]): string {
  const example = chapters[0];
  return example
    ? `「${argument}」对不上任何一章：/generate 后面跟章节序号，例如 /generate ${example.chapter_number}`
    : "这本书还没有章节：先在 B 目录里建一章，或在对话里说「新建第 1 章」";
}

const DOCK_MAX_HEIGHT = 420;
// 批注 8: the field already grows with what you type, so a second, manual way to
// size the same box was redundant - and the resting height was too short to read
// as a writing surface. Base is now 168 instead of 132.
const DOCK_BASE_HEIGHT = 168;
const INPUT_BASE_HEIGHT = 44;
const INPUT_MAX_HEIGHT = 180;

const GREETING =
  "我是这本书的写作 Agent。自然语言直接说就行，我会按相关度自动取用蓝图、目录、设定、人物、伏笔与章摘要；" +
  "用 @ 可以点名某份资料，斜杠命令走流水线：/generate /review /check /summary /save /plan /feedback /search。";

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
  // flatMap 而不是 map：一条命令行画不出卡片时就整个不画（批注 35.34）。让它退成一条
  // 答复气泡，等于把「看不见自己跑过的那一步」换成「界面在瞎说」。
  return rows.flatMap((row): Row[] => {
    if (row.role === "command") {
      const state = row.command_state;
      // 卡片还差的三样全在这一列里；比这条批注更老的服务器不带它，那一行就没有卡可画
      if (!state) return [];
      return [
        {
          kind: "command",
          id: row.id,
          command: state.command,
          status: state.status,
          // 结算文案只有 content 这一份：刷新回来的与屏上看过的逐字相同（判据）
          detail: row.content,
          runId: state.run_id ?? undefined,
          chapterId: state.chapter_id ?? undefined,
        },
      ];
    }
    if (row.role === "user") return [{ kind: "user", id: row.id, text: row.content }];
    const restoredApprovals = (row.steps ?? []).map(approvalFromStep).filter((item) => item !== null);
    const restoredRunId = (row.steps ?? []).find((step) => step.agent_run_id)?.agent_run_id;
    return [
      {
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
          // 31.4: the steps are stored with the answer, and this is the same line-maker
          // the live stream uses - so the trace after a reload is not a paraphrase.
          // The `??` is for a server older than this批注: measured 2026-09-10, without
          // it a response with no `steps` key dropped the entire history, not just
          // this column.
          reads: (row.steps ?? []).map(toolLine),
          mode: row.mode,
          reasoning: row.reasoning,
          agentRunId: restoredRunId,
          approvals: restoredApprovals,
        },
      },
    ];
  });
}

/* The same limits the server enforces (services/chat.py), checked here first so a
   wrong file is refused when it is picked rather than after the message is sent.
   The server still re-checks - this is courtesy, not trust. */
const ATTACH_SUFFIXES = [
  ".md", ".markdown", ".txt", ".text", ".rst", ".log", ".csv", ".tsv",
  ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".xml",
  ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css",
];
const ATTACH_ACCEPT = ATTACH_SUFFIXES.join(",");
const ATTACH_MAX_FILES = 8;
const ATTACH_MAX_CHARS_EACH = 20_000;
const ATTACH_MAX_CHARS_TOTAL = 60_000;

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error(`读取「${file.name}」失败`));
    reader.readAsText(file);
  });
}

export default function ChatPane({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const selectedNovelId = useWorkbench((s) => s.selectedNovelId);
  const llmStatus = useWorkbench((s) => s.llmStatus);
  const [configNoticeDismissed, setConfigNoticeDismissed] = useState(false);
  useEffect(() => {
    if (llmStatus?.configured) setConfigNoticeDismissed(false);
  }, [llmStatus?.configured]);
  const busy = useWorkbench((s) => s.busy);
  const setTab = useWorkbench((s) => s.setTab);
  const chatEpoch = useWorkbench((s) => s.chatEpoch);
  // 中栏看的是哪一条线程。null 交给后端答「当前线程」（28.8 那套语义）；
  // 从左边列表点进来时是一个号（第二十九批批注 6）。
  const chatConversation = useWorkbench((s) => s.chatConversation);
  const conversations = useWorkbench((s) => s.conversations);
  const refreshConversations = useWorkbench((s) => s.refreshConversations);
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("write");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [traceOpen, setTraceOpen] = useState<number | null>(null);
  // Two folds, two open states: 「思考过程」 is what the model thought, 「工具轨迹」 is
  // what it did. They arrive on different turns and must not open each other.
  const [thinkingOpen, setThinkingOpen] = useState<number | null>(null);
  // A copy button that says nothing is a fake control, so the row remembers that
  // it worked for a moment.
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ChatContextItem[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const [appliedProposals, setAppliedProposals] = useState<Record<string, FileProposal & { landedPath: string }>>({});

  const pendingFiles = useFiles((store) => store.pending);
  const offerFile = useFiles((store) => store.offer);
  const discardFile = useFiles((store) => store.discardProposal);
  const openFile = useFiles((store) => store.open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // A chapter proposal is previewed in the same file buffer as the prose page. The
  // tracker is only a concurrency guard: it is never a second source of document text.
  const draftStreams = useRef(new Map<string, { text: string; diverged: boolean }>());
  // 批注 36.4 补充：流式输出时自动滚到底部，但用户手动上翻时应停止自动滚动，
  // 直到用户滚回底部才恢复。stuckToBottom 标记是否跟随最新内容。
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const [railHover, setRailHover] = useState<number | null>(null);

  /* 批注 35.29c（D-57）：缺 D 层简报的那一章不再被推回去自己补——主人要的是「你要自己明白，
     要按顺序先生成一遍简章，然后再去生成正文」。briefHandoff 记的是「哪一条 /generate 正在
     等哪一章的简报」；autoLand 只在这一轮里给那一个 brief.md 路径免一次卡（别的文件、别轮
     次照样走卡，D-37 与 D-56 的边界都不动）。接力是**事件驱动**的：简报真的出现在 store 里
     才续写，所以他从卡片上点、还是从文件页自己存一份，两条路都能接上。 */
  const briefHandoff = useRef<{ chapterNumber: number; commandId: number } | null>(null);
  const autoLand = useRef<Set<string>>(new Set());

  /* 批注 35.34：命令行落库的账本——本地行 id → 「这张卡此刻的那一份 ＋ 它在库里那一行的
     id」（id 第一次结算之后才有）。它不是第二真源：界面读的还是 rows，这里只记「该往库里
     写什么」。为什么不从一份 rows 的快照里读：`/generate 9` 那一拍是先建卡、紧接着在同一次
     同步里判失败，React 还没落图，任何「渲染后的 rows」都还是空的——那一条恰恰最该留下痕。 */
  const commandRows = useRef(
    new Map<number, { row: Extract<Row, { kind: "command" }>; messageId?: number }>(),
  );

  // 一个 ref 一份订阅：StrictMode 双跑 effect 时两个监听器读同一个 ref，先到的那个把它清空，
  // 后到的直接 return——续写只会发生一次，不靠「忽略首执行」那种在真机上会失效的写法。
  useEffect(
    () =>
      useWorkbench.subscribe((state, previous) => {
        const handoff = briefHandoff.current;
        if (!handoff || state.briefs === previous.briefs) return;
        if (!state.briefs.some((item) => item.chapter_number === handoff.chapterNumber)) return;
        briefHandoff.current = null;
        autoLand.current.delete(briefPath(handoff.chapterNumber));
        void continueAfterBrief(handoff);
      }),
    [],
  );

  const running =
    streaming ||
    rows.some((row) => row.kind === "command" && row.status === "running");

  useEffect(() => {
    if (!stuckToBottom) return;
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight });
    } else if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [rows, stuckToBottom]);

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

  // Switching books - or opening a new conversation (第二十八批批注 8) - reloads
  // whatever thread that book is on now. The server decides which one that is.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setRows([]);
    if (!selectedNovelId) return;
    let cancelled = false;
    void refreshConversations();
    const thread =
      chatConversation === null ? "" : `?conversation=${chatConversation}`;
    api
      .get<StoredChatMessage[]>(`/api/novels/${selectedNovelId}/chat/messages${thread}`)
      .then(async (history) => {
        if (cancelled) return;
        const restoredRows = fromHistory(history);
        setRows(restoredRows);
        for (const restored of restoredRows) {
          if (restored.kind !== "agent" || !restored.meta.agentRunId) continue;
          void api.getAgentRun(restored.meta.agentRunId).then((run) => {
            if (!cancelled) setRows((current) => applyAgentRunState(current, restored.id, run));
          }).catch(() => undefined);
        }
        // The server keeps the fence in the stored reply, so a reload puts
        // every still-unapplied review card back on its own message.
        for (const row of history) {
          if (cancelled) return;
          if (row.role !== "assistant" || !row.proposals?.length) continue;
          /* A fence naming a retired .yaml path can never be applied again, so
             restoring it would only hang a dead error card on the thread.
             批注 35.20/35.21: neither can one the structure gate refused. Its 应用 mark is
             disabled, `applyProposal` refuses it at the only write entry, and D-38 already
             says the agent offers only valid proposals - so what came back on reload was a
             67-row box of words that could never be written, measured 2026-09-10 on 作品 6
             (+51 −16 on settings/characters/new.md). Restoring is not an exception to D-38. */
          const restorable = row.proposals.filter(
            (item) => item.valid && !item.path.endsWith(".yaml"),
          );
          for (const seed of restorable) {
            if (cancelled) return;
            // 批注 35.22: the card comes back; the tab strip the owner arranged does not.
            await offerFromStream(row.id, seed, { restore: true });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
    // refreshConversations 是 store 上的稳定引用，不进依赖也不会漏更新：
    // 线程变化由 chatEpoch 这一路统一触发（StrictMode 双跑同一条路）。
  }, [selectedNovelId, chatEpoch, chatConversation]);

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
    if (message.kind === "command") commandRows.current.set(message.id, { row: message });
    setRows((prev) => [...prev, message]);
  }

  function patchAgent(id: number, patch: Partial<AgentRow>) {
    setRows((prev) => patchRows(prev, id, patch));
  }

  /* 批注 35.34：命令行落库只有一个地方，就是这里。五种命令各自的结算、35.29c 那道接力的
     第二次结算、每一路的失败，全都从 patchCommand 过——写在调用点上就是十份副本。 */
  async function recordCommand(entry: { row: Extract<Row, { kind: "command" }>; messageId?: number }) {
    // 不读闭包里那个 selectedNovelId：接力那一次结算发生在几百毫秒之后
    const novelId = useWorkbench.getState().selectedNovelId;
    if (!novelId) return;
    try {
      const saved = await api.post<{ id: number }>(`/api/novels/${novelId}/chat/commands`, {
        message_id: entry.messageId ?? null,
        command: entry.row.command,
        status: entry.row.status,
        detail: entry.row.detail,
        run_id: entry.row.runId ?? null,
        chapter_id: entry.row.chapterId ?? null,
      });
      // 一条命令一行：往后同一张卡再结算，改写的是这一行
      commandRows.current.set(entry.row.id, { ...entry, messageId: saved.id });
    } catch {
      // 没写进库里，影响的只是下一次刷新看不到这张卡；此刻它正好好地待在屏上，
      // 不必再弹一条红字去抢它的屏（也不许把已经成功的这一步说成失败）。
    }
  }

  function patchCommand(id: number, patch: Partial<Extract<Row, { kind: "command" }>>) {
    const entry = commandRows.current.get(id);
    if (entry) commandRows.current.set(id, { ...entry, row: { ...entry.row, ...patch } });
    setRows((prev) => patchCommandRows(prev, id, patch));
    // running 不落库：刷新回来的那一条得是最后一次结算，不是一张转不完的圈
    if (!entry || (patch.status !== "done" && patch.status !== "failed")) return;
    void recordCommand({ ...entry, row: { ...entry.row, ...patch } });
  }

  // The stream carries the whole proposed file, so the diff the reader sees is
  // computed against the buffer we just re-read: a stale base shows up as a
  // rejected write rather than a silently wrong picture.
  async function offerFromStream(
    rowId: number,
    data: { path: string; text: string; valid: boolean; error: string | null },
    opts?: { restore?: boolean; autoLand?: boolean; writeMode?: boolean },
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
    const proposal: FileProposal = {
      id: nextProposalId++,
      path: data.path,
      text: data.text,
      valid: data.valid && Boolean(baseRevision),
      error: data.error || (baseRevision ? "" : "\u670d\u52a1\u5668\u4e0a\u6ca1\u6709\u8fd9\u4efd\u6587\u4ef6"),
      baseText,
      baseRevision,
    };
    /* 批注 35.20：已经逐字应用过的提案再挂一张就是陈卡，所以这里不 offerFile。
       批注 35.31：可这一份「这一行提议过什么」仍然要记在行上——摘掉气泡里那整份 JSON 的
       条件读的就是它。以前这里直接 return，那张卡不存在、记录也不存在，于是那份 JSON
       常年摊成一个代码框。卡片一张没多，只是这一行不再失忆。 */
    if (baseRevision && baseText === data.text) {
      discardFile(data.path);
      setRows((prev) => attachProposal(prev, rowId, proposal));
      return;
    }
    /* 批注 35.29b（D-56）：整章正文不再等一次「要不要放进渲染页」的确认——主人要审的是稿子，
       审的地方是那一章的正文页，确认点搬到定稿入库那一颗。落笔仍走唯一那条 PUT（就在
       applyProposal 里，actor:"ai" 且带着刚读到的 base_revision），只是这一次点击由系统替他按下。
       刷新恢复（opts.restore）不走这条路：那一次生成早就落过盘，此刻再写一遍会盖掉他之后
       在正文页改的字。写砸了就往下走，把卡挂回去——围栏里的字不许两头都不见。
       批注 35.29c（D-57）又开了一道**很窄**的口子：autoLand 只由 /generate 的补简报接力在
       这一轮里加上，名单里只有那一章的 brief.md 这一个路径，一轮过去就收回。其余 D 层简报
       的卡一张不少——那道口子不是按路径类型开的，是按「这一轮系统自己刚要去补的那一份」开的。 */
    const draftPathNumber = draftChapter(proposal.path);
    const draftStream = draftStreams.current.get(proposal.path);
    const localDraft = useFiles.getState().entries[proposal.path]?.draft;
    const draftPreviewUntouched =
      !draftStream ||
      (!draftStream.diverged && (localDraft ?? "") === draftStream.text);
    if (
      proposal.valid &&
      !opts?.restore &&
      opts?.writeMode === true &&
      (draftPathNumber !== null || proposal.path === "arcs.md" || opts?.autoLand === true) &&
      // If the author typed while the preview was arriving, leave the proposal on
      // the review card. The sole PUT remains available through an explicit click.
      draftPreviewUntouched
    ) {
      offerFile(proposal);
      if (await useFiles.getState().applyProposal(proposal.path)) {
        markApplied(proposal, useFiles.getState().lastAppliedPath ?? proposal.path);
        // 批注 36.4 补充：正文提案自动应用后，切到编辑器让主人看到内容出现，
        // 而不是留在对话页以为「写完了突然刷出来」。
        const chapterNumber = draftChapter(proposal.path);
        if (chapterNumber !== null) {
          const chapter = useWorkbench.getState().chapters.find((item) => item.chapter_number === chapterNumber);
          if (chapter) {
            useWorkbench.getState().selectChapter(chapter.id);
            useWorkbench.getState().openChapterTab(chapter.id);
          }
        }
        // 补简报那一份自己重读两源：右栏那格重读挂在文件页签上，而 /generate 跑的时候
        // 主人多半在正文页，不重读简报永远不「出现」，接力就静默停在半路（35.29c）。
        if (opts?.autoLand === true) await useWorkbench.getState().reloadChapterList();
        return;
      }
    }
    setRows((prev) => attachProposal(prev, rowId, proposal));
    offerFile(proposal, opts);
  }

  function markApplied(proposal: FileProposal, landedPath: string) {
    setAppliedProposals((prev) => ({ ...prev, [`${proposal.path}:${proposal.id}`]: { ...proposal, landedPath } }));
  }

  async function applyProposal(path: string, proposal?: FileProposal) {
    const snapshot = proposal ?? useFiles.getState().pending[path];
    setApplyingPath(path);
    const applied = await useFiles.getState().applyProposal(path);
    setApplyingPath(null);
    if (applied && snapshot) markApplied(snapshot, useFiles.getState().lastAppliedPath ?? path);
  }

  function applyDraftPreview(data: { path: string; text: string }) {
    // The backend intentionally emits only chapter draft paths. Keep this check at
    // the UI boundary as a defense-in-depth guard against a malformed event.
    if (draftChapter(data.path) === null) return;
    const state = useFiles.getState();
    const entry = state.entries[data.path];
    let tracker = draftStreams.current.get(data.path);
    if (!tracker) {
      const existing = entry?.draft ?? "";
      tracker = {
        text: existing,
        diverged: Boolean(entry?.doc && existing !== entry.doc.text),
      };
      draftStreams.current.set(data.path, tracker);
    }
    const current = useFiles.getState().entries[data.path]?.draft ?? "";
    if (!tracker.diverged && current !== tracker.text) tracker.diverged = true;
    if (tracker.diverged) return;
    const chapterNumber = draftChapter(data.path);
    const preview =
      chapterNumber !== null && data.text.trimStart().startsWith("# ")
        ? data.text
        : chapterNumber !== null
          ? draftDocument(chapterNumber, data.text)
          : data.text;
    useFiles.getState().setDraft(data.path, preview);
    tracker.text = preview;
  }

  function applyEvent(id: number, event: ChatStreamEvent, turnMode: ChatMode) {
    // 规则在 chatRows.ts（纯函数）。三个副作用留在外面：放进 setRows 的更新函数里，
    // StrictMode 会把它们跑两遍（本项目 2026-09-03 记过的同一形状）。
    setRows((prev) => applyStreamEvent(prev, id, event));
    if (event.event === "draft") applyDraftPreview(event.data);
    if (event.event === "proposal")
      void offerFromStream(
        id,
        event.data,
        turnMode === "write" && autoLand.current.has(event.data.path) ? { autoLand: true, writeMode: true } : { writeMode: turnMode === "write" },
      );
    if (event.event === "context") void refreshConversations();
    if (event.event === "reasoning") setThinkingOpen(id);
  }

  async function decideAgentApproval(
    rowId: number,
    runId: number,
    toolCallId: number,
    decision: "approved" | "rejected",
  ) {
    const run = await api.resumeAgentRun(runId, toolCallId, decision);
    setRows((current) => applyAgentRunState(current, rowId, run));
  }

  async function ask(question: string, replaceId?: number, suppressUser = false) {
    const text = question.trim();
    if (!text || !selectedNovelId || running) return;
    const agentId = replaceId ?? nextId++;
    const turnMode = mode;

    if (replaceId === undefined && !suppressUser) {
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
    const files = attachments;
    try {
      await api.streamChat(
        selectedNovelId,
        {
          content: text,
          mode: turnMode,
          // 现取不取闭包：/generate 5 那一条在同一趟里先把选中章换过去再发这一句，
          // 渲染闭包里还是旧的那一章，注入的资料会跟着错（批注 35.29c）。
          chapter_id: useWorkbench.getState().selectedChapterId,
          model: selectedModel,
          attachments: files.length ? files : undefined,
        },
        (event) => applyEvent(agentId, event, turnMode),
        controller.signal,
      );
      // Cleared only once the turn actually went out. The old bug was the other way
      // round: chips survived a send they had nothing to do with (第十九批批注 1).
      if (replaceId === undefined && files.length) setAttachments([]);
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
      // 第一句话落库以后这条线程才**成为**一条历史对话：左栏那一页得跟着长出来，
      // 不能等主人刷新（第二十九批批注 6）。
      void refreshConversations();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

/** FileReader, not File.text(): jsdom has no text() on File, and the portrait picker
 *  in this app already reads files this way - one idiom, testable in both places. */

  /* Reading is deliberately rejected rather than truncated: half a file injected
     silently is worse than no file, and the owner sees which one and why. */
  async function pickAttachments(files: FileList | null) {
    if (!files?.length) return;
    setAttachError(null);
    const next: ChatAttachment[] = [];
    for (const file of [...files]) {
      const suffix = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!ATTACH_SUFFIXES.includes(suffix)) {
        setAttachError(`「${file.name}」不是可读取的文本文件（支持 md / txt / json / yaml / csv / 代码等）`);
        return;
      }
      if (file.size > ATTACH_MAX_CHARS_EACH * 4) {
        setAttachError(`「${file.name}」太大，单个附件上限 ${ATTACH_MAX_CHARS_EACH} 字`);
        return;
      }
      const text = await readAsText(file);
      if (!text.trim()) {
        setAttachError(`「${file.name}」是空的`);
        return;
      }
      if (text.trim().length > ATTACH_MAX_CHARS_EACH) {
        setAttachError(`「${file.name}」有 ${text.trim().length} 字，超过单个上限 ${ATTACH_MAX_CHARS_EACH} 字`);
        return;
      }
      next.push({ name: file.name, text });
    }
    setAttachments((prev) => {
      const merged = [...prev, ...next.filter((item) => !prev.some((had) => had.name === item.name))];
      if (merged.length > ATTACH_MAX_FILES) {
        setAttachError(`附件最多 ${ATTACH_MAX_FILES} 个`);
        return prev;
      }
      if (merged.reduce((sum, item) => sum + item.text.length, 0) > ATTACH_MAX_CHARS_TOTAL) {
        setAttachError(`附件合计超过 ${ATTACH_MAX_CHARS_TOTAL} 字上限`);
        return prev;
      }
      return merged;
    });
  }

  // The field grows with what the reader types, up to a ceiling, and the dock grows
  // by the same amount: a fixed two-line box that scrolls internally is the bug the
  // owner pointed at, and an unbounded one would eat the message list.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [typingGrow, setTypingGrow] = useState(0);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Measure from zero: `auto` reports the height the grid row already gave it, so a
    // cleared field would never shrink back.
    el.style.height = "0px";
    const used = Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_BASE_HEIGHT, el.scrollHeight));
    el.style.height = `${used}px`;
    setTypingGrow(Math.max(0, used - INPUT_BASE_HEIGHT));
  }, [input]);



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
    void ask(
      `请盘点${target.label}当前的缺口与内部冲突，并列出下一步待办清单。${target.mention}`,
      undefined,
      true,
    );
  }

  function runSearch(rest: string) {
    const query = rest.trim();
    if (!query) {
      appendMessage({
        kind: "agent",
        id: nextId++,
        text: "",
        status: "error",
        question: "",
        meta: {},
        error: "用法：/search <要查的词>",
      });
      return;
    }
    // The command does not search by itself: it asks for the web_search tool and
    // lets the loop report what actually came back, found or not.
    void ask(
      `请用 web_search 查证「${query}」。只报查到的内容和来源链接；查不到就直说查不到，不要用记忆里的印象冒充查证结果。`,
      undefined,
      true,
    );
  }

  /* 生成那一步的结算只有一处：/generate 自己走完走这里，35.29c 的接力走完也走这里——
     同一个形状（哪一章、多少字、机械校验过没过）不许在两条路上各写一份文案。 */
  async function settleGenerate(id: number, errorBefore: string | null) {
    const snapshot = useWorkbench.getState();
    const chapter = snapshot.chapters.find((item) => item.id === snapshot.selectedChapterId);
    if (snapshot.error && snapshot.error !== errorBefore) {
      patchCommand(id, { status: "failed", detail: snapshot.error });
    } else if (chapter) {
      patchCommand(id, {
        status: "done",
        chapterId: chapter.id,
        detail: `第 ${chapter.chapter_number} 章候选已生成，工作稿未改动；请在正文工具栏“查看候选”中审核并接受`,
      });
    } else {
      patchCommand(id, { status: "failed", detail: "未找到可生成的简报，先在 B 目录或 D 简报里建一章" });
    }
  }

  /* 批注 35.29c（D-57）：简报真的落到那一章上了，正文这一步才接着跑。generateDraft 找简报
     认的是选中章（brief_id 或同号的 brief），所以先把那一章端到前面。 */
  async function continueAfterBrief(handoff: { chapterNumber: number; commandId: number }) {
    const state = useWorkbench.getState();
    const chapter = state.chapters.find((item) => item.chapter_number === handoff.chapterNumber);
    if (!chapter) return;
    state.openChapterTab(chapter.id);
    const live = useWorkbench.getState();
    patchCommand(handoff.commandId, {
      status: "running",
      detail: `第 ${handoff.chapterNumber} 章简报已落，开始写正文`,
    });
    const errorBefore = useWorkbench.getState().error;
    await live.generateDraft();
    await settleGenerate(handoff.commandId, errorBefore);
  }

  async function runCommand(raw: string) {
    const [name, ...rest] = raw.split(/\s+/);
    const command = commands.find((item) => item.name === name);
    const state = useWorkbench.getState();
    if (!command || !state.selectedNovelId || running) return;
    const argument = rest.join(" ");
    appendMessage({ kind: "user", id: nextId++, text: raw });

    if (command.name === "/plan") {
      runPlan(argument);
      return;
    }

    if (command.name === "/search") {
      runSearch(argument);
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
        if (argument) {
          const picked = chapterByArgument(argument, useWorkbench.getState().chapters);
          if (!picked) {
            patchCommand(id, {
              status: "failed",
              detail: unmatchedChapter(argument, useWorkbench.getState().chapters),
            });
            return;
          }
          useWorkbench.getState().openChapterTab(picked.id);
        }
        /* 批注 35.29c（D-57）：缺简报不再是「推回去自己补」。主人常常忘了先生成简报，
           所以这一步由系统自己按顺序补齐——先那一章的 D 层简报，再它的正文。 */
        const live = useWorkbench.getState();
        const target = live.chapters.find((item) => item.id === live.selectedChapterId) ?? null;
        // 与 generateDraft 同一把尺子：它说「有简报、可以开写」的地方，这里就不许改道去补简报
        if (target && !findBriefForChapter(target, live.briefs, live.selectedBriefId)) {
          const path = briefPath(target.chapter_number);
          briefHandoff.current = { chapterNumber: target.chapter_number, commandId: id };
          autoLand.current.add(path);
          patchCommand(id, {
            status: "done",
            detail: `第 ${target.chapter_number} 章还没有 D 层简报：先补简报，它一落地就自动接着写正文`,
          });
          await ask(
            `第 ${target.chapter_number} 章《${target.title || "未命名"}》还没有 D 层简报。` +
              `只给这一章调用 propose_chapter_brief，goal 与 events 按 B 目录里这一章的章名和它在目录中的位置来写；` +
              `不要写正文，也不要顺带补别的章。`,
            undefined,
            true,
          );
          autoLand.current.delete(path);
          return;
        }
        await state.generateDraft();
        await settleGenerate(id, errorBefore);
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
    /* The gateway models this app runs on do not return native tool calls, so an
       imperative sentence would otherwise come back as an empty reply. Route the
       two production commands by intent and keep the same audited pipeline. */
    if (/(质\s*检|自\s*检|审\s*稿)/.test(text)) {
      void runCommand("/review");
      return;
    }
    if (/(生成|续写|写)(一下|一段|这一章|本章|正文|第\s*\d+\s*章)/.test(text)) {
      const chapter = /第\s*(\d+)\s*章/.exec(text);
      void runCommand(chapter ? `/generate ${chapter[1]}` : "/generate");
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

  /** 批注: the reply ends with what you can do with it - copy, and the same text
   *  as a .md file. Codex does this and the owner asked for it by name. */
  function copyReply(row: Extract<Row, { kind: "agent" }>) {
    void navigator.clipboard.writeText(row.text).then(() => {
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1600);
    });
  }

  function downloadReply(row: Extract<Row, { kind: "agent" }>) {
    const blob = new Blob([row.text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `对话回复-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const userRows = rows.filter((row) => row.kind === "user");
  const dockHeight = Math.min(DOCK_MAX_HEIGHT, DOCK_BASE_HEIGHT + typingGrow);
  const currentConversationId =
    chatConversation ??
    conversations.find((item) => item.is_current)?.conversation_id ??
    null;
  // The rail has an absolute height ceiling. More questions compress the hit
  // bands instead of growing the rail off the pane; bands never overlap.
  const railHit = Math.max(1, Math.min(16, Math.floor(248 / Math.max(1, userRows.length))));
  const slashHints = input.startsWith("/") && !busy;
  const [typedName] = input.trim().split(/\s+/);
  const matched = commands.filter((item) => item.name.startsWith(typedName));
  const showMentions = mentionQuery !== null;

  return (
    <section className={`chat-pane ${className}`} aria-label="AI 对话">
      {llmStatus && !llmStatus.configured && !configNoticeDismissed && (
        <div className="chat-notice" role="status">
          <span>模型接入未完成，请在
          <button type="button" className="chat-notice-action" onClick={() => navigate("/settings")}>
            设置
          </button>
          中检查连接与任务模型</span>
          <IconButton type="button" aria-label="关闭配置提示" title="关闭配置提示" onClick={() => setConfigNoticeDismissed(true)}><X size={13} /></IconButton>
        </div>
      )}
      <div
        className="chat-messages"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const threshold = 50;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < threshold;
          setStuckToBottom(atBottom);
        }}
      >
        {(rows.length ? rows : [{
          kind: "agent" as const,
          id: 0,
          greeting: true,
          text: GREETING,
          status: "done" as const,
          question: "",
          meta: {},
        }]).map((row) => {
          if (row.kind === "user") {
            return (
              /* 批注: no avatars - the owner said to lay this out like Codex, which
                 names the speaker in a line of text instead. Yours is the one on the
                 right, so it needs no face to tell you who said it. */
              <div key={row.id} className="chat-row user" data-chat-row={row.id}>
                <div className="chat-bubble">{row.text}</div>
              </div>
            );
          }
          if (row.kind === "command") {
            const seconds = row.status === "running" ? elapsed : null;
            return (
              <div key={row.id} className="chat-row assistant">
                <div className="chat-message">
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
                    {row.status === "done" && row.runId && row.chapterId && selectedNovelId ? (
                      <div className="command-actions">
                        <button
                          type="button"
                          className="primary"
                          aria-label="查看调用详情"
                          title="查看调用详情"
                          onClick={() =>
                            navigate(
                              `/novels/${selectedNovelId}/chapters/${row.chapterId}/runs/${row.runId}`,
                            )
                          }
                        >
                          <ScrollText size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="在正文打开"
                          title="在正文打开"
                          onClick={() =>
                            navigate(`/novels/${selectedNovelId}?chapter=${row.chapterId}`)
                          }
                        >
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          }
          const usage = tokens(row.meta.tokenInput, row.meta.tokenOutput);
          // 第二十三批批注 3 排序、第二十四批批注 3 压缩，都在 compressRefs 里做
          // 完：层序表与分组键只许有一个出处，这里再排一遍就是第二个真源。
          // refs 仍留着原本的条数 - 「引用 29 份资料」那句话说的是真数，
          // 压缩只改变它画成几个框子，不改变注入了多少份。
          const refs = row.meta.refs ?? [];
          const chips = compressRefs(refs);
          // The trace is not prose. Fold it above the answer instead of printing it.
          const { prose, trace } = splitTrace(stripProposalFences(row.text, row.proposals ?? []));
          const reasoning = reasoningParagraphs(row.meta.reasoning ?? "");
          return (
            <div key={row.id} className="chat-row assistant">
              <div className="chat-message">
                <div className={`chat-card agent ${row.status}`}>
                  {/* 第十六批批注 1: the entry the owner was still missing. The fold that
                      was here is called 思考过程 but only ever listed tool calls, so a
                      plain answer had no way to show what the model actually thought.
                      No reasoning from the model means no entry - not an empty shell. */}
                  {reasoning.length ? (
                    <div className="chat-trace chat-thinking">
                      <button
                        type="button"
                        className="chat-meta"
                        aria-expanded={thinkingOpen === row.id}
                        onClick={() => setThinkingOpen(thinkingOpen === row.id ? null : row.id)}
                      >
                        <Brain size={11} />
                        <span>思考过程</span>
                        <ChevronDown size={11} />
                      </button>
                      {/* 第十七批批注 1: thinking is prose, so it is set as prose - no
                          box around it, no monospace, wrapping like the answer. The
                          bordered block stays for the tool trace, which IS commands. */}
                      {thinkingOpen === row.id ? (
                        <div className="chat-thinking-body">
                          {reasoning.map((paragraph, index) => (
                            <p key={index}>{paragraph}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {trace.length ? (
                    <div className="chat-trace">
                      <button
                        type="button"
                        className="chat-meta"
                        aria-expanded={traceOpen === row.id}
                        onClick={() => setTraceOpen(traceOpen === row.id ? null : row.id)}
                      >
                        <Wrench size={11} />
                        <span>工具轨迹 · {trace.length} 步</span>
                        <ChevronDown size={11} />
                      </button>
                      {/* 第十八批批注 1 的后半：命令用条目呈现 - 动作名 + 参数 chip，
                          不再是把日志原文摊在一个等宽方框里。解析不出动作的行退回原文，
                          宁可难看也不能把跑过的东西说错。 */}
                      {traceOpen === row.id ? (
                        <ul className="chat-trace-list">
                          {traceActions(trace).map((action, index) => (
                            <li className="chat-trace-row" key={index}>
                              {action.name ? (
                                <>
                                  {action.name === "web_search" ? (
                                    <Search size={12} aria-hidden="true" />
                                  ) : (
                                    <FileText size={12} aria-hidden="true" />
                                  )}
                                  <span>{ACTION_LABELS[action.name] ?? action.name}</span>
                                  {action.arg ? <code className="chat-trace-chip">{action.arg}</code> : null}
                                </>
                              ) : (
                                <pre className="chat-trace-body">{action.raw}</pre>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {prose || row.status !== "streaming" ? (
                    <MarkdownText
                      text={prose}
                      className={row.greeting ? "chat-greeting" : undefined}
                      tail={
                        row.status === "streaming" ? (
                          <span className="chat-caret" aria-hidden="true" />
                        ) : null
                      }
                    />
                  ) : (
                    <p>正在思考…</p>
                  )}
                  {(row.proposals ?? []).map((item) => {
                    if (pendingFiles[item.path]?.id === item.id) {
                      return <ProposalCard
                        key={`${item.path}:${item.id}`}
                        proposal={item}
                        applying={applyingPath === item.path}
                        onOpen={() => void openFile(item.path)}
                        onApply={() => void applyProposal(item.path, item)}
                        onDiscard={() => discardFile(item.path)}
                      />;
                    }
                    const applied = appliedProposals[`${item.path}:${item.id}`];
                    if (!applied) return null;
                    const heading = /^#\s+(.+)$/m.exec(item.text)?.[1] ?? item.path;
                    const title = heading.replace(/（[^）]*）\s*$/, "").trim();
                    return <section className="proposal-applied" key={`${item.path}:${item.id}`} aria-label="已应用提案">
                      <header><strong>已应用</strong><code>{applied.landedPath}</code></header>
                      <p>{title}</p>
                      <footer>
                        <span>原回答保留，只改了目标片段</span>
                        <Button compact onClick={() => void openFile(applied.landedPath)}>查看文件</Button>
                      </footer>
                    </section>;
                  })}
                  {(row.meta.approvals ?? []).map((approval) => {
                    const diff = approval.preview.diff as Record<string, unknown> | undefined;
                    return (
                      <section className="agent-approval" key={approval.toolCallId} aria-label="高风险操作确认">
                        <header>
                          <code>{approval.command}</code>
                          <span>{approval.state === "pending" ? "等待确认" : approval.state === "approved" ? "已批准" : "已拒绝"}</span>
                        </header>
                        <pre>{JSON.stringify(diff ?? approval.preview, null, 2)}</pre>
                        {approval.state === "pending" ? (
                          <footer>
                            <button
                              type="button"
                              aria-label="拒绝高风险操作"
                              title="拒绝"
                              onClick={() => void decideAgentApproval(row.id, approval.agentRunId, approval.toolCallId, "rejected")}
                            >
                              <X size={14} />
                            </button>
                            <button
                              type="button"
                              className="approve"
                              aria-label="批准高风险操作"
                              title="批准并执行"
                              onClick={() => void decideAgentApproval(row.id, approval.agentRunId, approval.toolCallId, "approved")}
                            >
                              <Check size={14} />
                            </button>
                          </footer>
                        ) : null}
                      </section>
                    );
                  })}
                  {row.status === "error" ? (
                    <div className="chat-error">
                      <span>{row.error}</span>
                      {row.question ? (
                        <button
                          type="button"
                          className="chat-retry"
                          aria-label="重试这一问"
                          title="重试这一问"
                          onClick={() => void ask(row.question, row.id)}
                        >
                          <RotateCcw size={12} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {/* 批注 3, 4, 5: one quiet row at the end of the answer - copy,
                      download, the token fold, and the model that answered - and it
                      appears with the pointer. While an answer is still arriving the
                      row stays on screen because 生成中 is the only status left.
                      (Written without the braces this is JSX text, not a comment -
                      it printed on screen until the screenshot caught it.) */}
                  <div className={`chat-actions ${row.status === "streaming" ? "live" : ""}`}>
                    {row.status === "streaming" ? (
                      <span className="chat-state">
                        <i className="spinner" aria-hidden="true" />
                        <span>生成中</span>
                      </span>
                    ) : null}
                    {row.status !== "streaming" && prose ? (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="复制这条回复"
                          title="复制"
                          onClick={() => copyReply(row)}
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="下载为 .md"
                          title="下载为 .md"
                          onClick={() => downloadReply(row)}
                        >
                          <Download size={13} />
                        </button>
                        {copiedId === row.id ? <span className="chat-copied">已复制</span> : null}
                      </>
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
                    {/* 批注 4: what is left of the speaker line is the model - "Agent" is
                        only ever one of two voices in here. */}
                    {row.status !== "streaming" && row.meta.model ? (
                      <span className="chat-who">{row.meta.model}</span>
                    ) : null}
                    {/* 批注 4 说过说话行剩下的就是模型；批注 35.15 把模式也搬回这一行——
                        D-41 之后 composer 那个开关只是「下一句拨到哪」，这一答按什么办的，
                        开关上看不出来。写「按「计划」」而不是光秃秃一个「计划」，是为了
                        同一屏不许出现两处互相矛盾的模式说法。 */}
                    {row.meta.mode ? (
                      <span className="chat-mode" aria-label={`这一答按「${modeLabel(row.meta.mode)}」处理`}>
                        按「{modeLabel(row.meta.mode)}」
                      </span>
                    ) : null}
                  </div>
                  {expanded === row.id ? (
                    <div className="chat-detail">
                      <p className="chat-detail-line">
                        输入 {row.meta.tokenInput ?? 0} / 输出 {row.meta.tokenOutput ?? 0} tokens
                        {row.meta.model ? ` · ${row.meta.model}` : ""}
                      </p>
                      {row.meta.reads?.length ? (
                        <>
                          {/* 「本轮读取」是这列的标题，说一次就够 - 每一行自己带着
                              第几步、跑了什么、多久、多少字（§六 第 2 步）。 */}
                          <p className="chat-detail-line">本轮读取 · {row.meta.reads.length} 步</p>
                          {/* 用轨迹那一套列表，不用引用的胶囊：一行是一句「第几步跑了什么」，
                              不是一颗标签。`.chat-trace-list` 早被 uiInvariants 钉成不许有边框底色。 */}
                          <ul className="chat-trace-list">
                            {row.meta.reads.map((line, index) => (
                              <li className="chat-trace-row" key={`${index}:${line}`}>{line}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      {refs.length ? (
                        <ul className="chat-refs">
                          {chips.map((chip) => (
                            <li key={chip.key} title={chip.detail.join("\n")}>
                              {chip.label}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="chat-detail-empty">
                          本轮没有检索到资料
                          {row.meta.allowed?.length ? ` · 可用工具 ${row.meta.allowed.join(" / ")}` : ""}
                        </p>
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
      {userRows.length > 1 ? <nav className="chat-question-rail" aria-label="问题导航">
        {userRows.map((row, index) => (
          <button
            key={row.id}
            type="button"
            aria-label={`跳到第 ${index + 1} 个问题`}
            title={row.text.slice(0, 60)}
            style={{
              flex: `0 0 ${railHit}px`,
              height: railHit,
              minHeight: railHit,
              maxHeight: railHit,
              opacity: railHover === null ? 0.5 : railHover === index ? 1 : Math.max(0.28, 1 - Math.abs(index - railHover) * 0.18),
              transform: `scaleX(${railHover === null ? 1 : Math.max(0.45, 1 - Math.abs(index - railHover) * 0.12)})`,
            }}
            onMouseEnter={() => setRailHover(index)}
            onMouseLeave={() => setRailHover(null)}
            onFocus={() => setRailHover(index)}
            onBlur={() => setRailHover(null)}
            onClick={() => {
              const node = scrollRef.current?.querySelector<HTMLElement>(`[data-chat-row="${row.id}"]`);
              node?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          />
        ))}
      </nav> : null}
      {!stuckToBottom ? <button
        type="button"
        className="chat-scroll-bottom"
        aria-label="回到底部"
        title="回到底部"
        style={{ bottom: dockHeight + 12 }}
        onClick={() => {
          const node = scrollRef.current;
          node?.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
          setStuckToBottom(true);
        }}
      >
        <ArrowDown size={14} />
      </button> : null}
      <div className="chat-dock" style={{ height: dockHeight }}>
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
        <div className="composer">
          {/* 主人给的参考图就是这个形状：× + 图标 + 文件名，一枚一枚排在输入框上方。 */}
          {attachments.length ? (
            <div className="chat-attachments" aria-label="已选附件">
              {attachments.map((item) => (
                <span className="chat-attachment-chip" key={item.name}>
                  <button
                    type="button"
                    className="chat-attachment-drop"
                    aria-label={`移除附件 ${item.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((had) => had.name !== item.name))}
                  >
                    <X size={11} />
                  </button>
                  <FileText size={12} aria-hidden="true" />
                  <span className="chat-attachment-name">{item.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {attachError ? <p className="chat-attach-error">{attachError}</p> : null}
          <div className="chat-input">
            <textarea
              ref={inputRef}
              value={input}
              rows={2}
              placeholder="/ 命令 · @ 资料"
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
          </div>
          <div className="chat-toolbar">
            {/* 批注 35.28（方案 1）：这两颗从此只是状态栏。模式由主人这句话判（D-41），
                一颗点了却决定不了任何事的开关只剩误导（「我点了『写作』，它自动切成『计划』」）。
                disabled 与 aria-disabled 是两个用途：前者让它真的点不动、也不进 Tab 序，
                后者是这条批注判据要能在 DOM 上量到的那个属性。要回硬交互得先立新决定推翻 D-41。 */}
            <div
              className="mode-switch"
              role="radiogroup"
              aria-label="对话模式"
              title="计划模式只读；写作模式允许自动写入章节正文与补齐简报"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === "plan"}
                className={mode === "plan" ? "selected" : ""}
                onClick={() => setMode("plan")}
              >
                {modeLabel("plan")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "write"}
                className={mode === "write" ? "selected" : ""}
                onClick={() => setMode("write")}
              >
                {modeLabel("write")}
              </button>
            </div>
            {/* 第十九批批注 1: this used to be disabled because the old picker dropped
                the selection on the floor. It now hands the text to the same context list
                @ and the collectors feed, so the model really sees it. */}
            <button
              type="button"
              className="chat-attach"
              aria-label="上传附件"
              title="上传附件 · 文本类文件，随本条消息注入"
              onClick={() => attachRef.current?.click()}
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={attachRef}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              className="chat-attach-input"
              aria-label="选择附件文件"
              onChange={(event) => {
                void pickAttachments(event.target.files);
                event.target.value = "";
              }}
            />
            {/* 批注 35.29b（D-56）：这里原来有一颗「确认并生成」，选中章节就出现、点一下才跑
                /generate。撤掉：它守的那条路本来就逐字流式（workbench.ts 里每个 delta 直接
                setDraft 进正文页缓冲），这道确认从没挡住任何东西；主人要的确认是定稿入库，
                不是「要不要把正文放进渲染页」。发起生成只剩 /generate 这一条命令。 */}
            <Button
              compact
              disabled={!currentConversationId || !selectedNovelId}
              title="查看这条对话的 token、模型与工具步骤"
              onClick={() => {
                if (selectedNovelId && currentConversationId) {
                  navigate(`/novels/${selectedNovelId}/conversations/${currentConversationId}`);
                }
              }}
            >
              对话详情
            </Button>
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
        </div>
      </div>
    </section>
  );
}
