/**
 * 对话区的行模型：流式事件 -> 行序列的规则全在这里，全是纯函数。
 *
 * 为什么单独一个文件（候选 6，2026-09-07）：这些规则原先埋在 ChatPane.tsx 的 applyEvent 里，
 * 想验「reasoning 先到、正文后到」「done 不许抹掉先前工具轨迹」只能 stubGlobal(fetch) +
 * 手拼 SSE 字节 + 整树渲染——正是本项目「StrictMode 下 effect 跑两遍」那类教训的形状。
 * 搬成纯函数后，测试直接喂事件数组即可，与渲染、网络、StrictMode 都无关。
 *
 * 副作用不在这个文件里：提案落库、刷左栏、打开折叠仍归 ChatPane，且必须留在
 * setRows 的更新函数**外面**（放在里面会被 StrictMode 跑两遍）。
 */
import type { ChatReference, ChatStreamEvent, FileProposal } from "../types";

export type CommandStatus = "running" | "done" | "failed";

export type AgentMeta = {
  model?: string;
  tokenInput?: number;
  tokenOutput?: number;
  refs?: ChatReference[];
  unknown?: string[];
  /** Tool calls this turn executed, in order. */
  reads?: string[];
  /** What the turn was allowed to reach for, so an empty round reads as
      "did not need it" rather than "cannot". */
  allowed?: string[];
  /** The model's own reasoning, when the model gave any. */
  reasoning?: string;
};

export type AgentRow = {
  kind: "agent";
  id: number;
  text: string;
  status: "streaming" | "done" | "error";
  question: string;
  meta: AgentMeta;
  error?: string;
  proposals?: FileProposal[];
  /** 开场白那一条不是 Agent 答的话，是一句界面提示 - 它用思考那张脸（批注 4）。 */
  greeting?: boolean;
};

export type Row =
  | { kind: "user"; id: number; text: string }
  | AgentRow
  | {
      kind: "command";
      id: number;
      command: string;
      status: CommandStatus;
      detail: string;
      startedAt: number;
      runId?: number;
      chapterId?: number;
    };

export const userRow = (id: number, text: string): Row => ({ kind: "user", id, text });

/** 只动这一条 agent 行；id 对不上就原样返回（不产生新数组之外的副作用）。 */
export function patchAgent(rows: Row[], id: number, patch: Partial<AgentRow>): Row[] {
  return rows.map((row) => (row.kind === "agent" && row.id === id ? { ...row, ...patch } : row));
}

export function patchCommand(rows: Row[], id: number, patch: Partial<Extract<Row, { kind: "command" }>>): Row[] {
  return rows.map((row) => (row.kind === "command" && row.id === id ? { ...row, ...patch } : row));
}

/**
 * One executed step, as the trace should read it: which step, what it ran, how long it
 * took and how much came back (§六 第 2 步判据 31.1 - 预算交给框架之后，代价要摊到每一步，
 * 不能只在「本轮共花多少」里出现一次).
 *
 * The numbers arrive from the backend, which measured them around the call. Nothing here
 * is invented or padded: a step that returned nothing reads 「0 字」, and that is the point.
 */
export function toolLine(event: Extract<ChatStreamEvent, { event: "tool" }>["data"]): string {
  const subject = Object.values(event.arguments).join(", ");
  const head = `第 ${event.step} 步 · ${event.name}${subject ? ` ${subject}` : ""}`;
  const line = `${head} · ${duration(event.ms)} · ${count(event.chars)} 字`;
  return event.ok ? line : `${line} 未成功`;
}

/** 1400ms 说成「1.4s」，不到一秒照实说毫秒 - 不把 0.02s 骗成 0s。 */
const duration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/** 1234 字说成「1.2k」；三位数以内直接写整数。 */
const count = (chars: number) => (chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : `${chars}`);

/**
 * 一条流事件如何改写行序列。`proposal` 不改行（它由 ChatPane 交给 offerFromStream），
 * 其余每一支都不许丢掉先前到达的事实：工具轨迹、refs、已流出的思考过程。
 */
export function applyStreamEvent(rows: Row[], id: number, event: ChatStreamEvent): Row[] {
  switch (event.event) {
    case "proposal":
      return rows;
    case "context":
      return patchAgent(rows, id, {
        meta: {
          ...metaOf(rows, id),
          refs: event.data.items.map(({ kind, label, ref }) => ({ kind, label, ref })),
          unknown: event.data.unknown_mentions,
          allowed: event.data.tools ?? [],
        },
      });
    case "tool": {
      const meta = metaOf(rows, id);
      return patchAgent(rows, id, { meta: { ...meta, reads: [...(meta.reads ?? []), toolLine(event.data)] } });
    }
    case "reasoning": {
      const meta = metaOf(rows, id);
      return patchAgent(rows, id, {
        meta: { ...meta, reasoning: (meta.reasoning ?? "") + event.data.text },
      });
    }
    case "delta": {
      const row = agent(rows, id);
      return patchAgent(rows, id, { text: (row?.text ?? "") + event.data.text });
    }
    case "done": {
      const meta = metaOf(rows, id);
      const message = event.data.message;
      return patchAgent(rows, id, {
        text: message.content,
        status: "done",
        meta: {
          // 早到的事实在后：done 不许把工具轨迹与 allowed 抹掉；refs 也是「先到的赢」。
          ...meta,
          model: message.model,
          tokenInput: message.token_input,
          tokenOutput: message.token_output,
          refs: meta.refs?.length ? meta.refs : message.context_refs,
          unknown: meta.unknown,
          reasoning: message.reasoning || meta.reasoning,
        },
      });
    }
    case "error": {
      return patchAgent(rows, id, {
        status: "error",
        error: event.data.message || "模型没有返回内容",
        text: event.data.partial || "",
      });
    }
    default:
      // end：干净收尾时才把还在 streaming 的那条落到 done
      return rows.map((row) =>
        row.kind === "agent" && row.id === id && row.status === "streaming"
          ? { ...row, status: "done" }
          : row,
      );
  }
}

function agent(rows: Row[], id: number): AgentRow | undefined {
  return rows.find((row): row is AgentRow => row.kind === "agent" && row.id === id);
}

function metaOf(rows: Row[], id: number): AgentMeta {
  return agent(rows, id)?.meta ?? {};
}
