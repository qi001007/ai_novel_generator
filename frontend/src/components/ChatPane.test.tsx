import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatPane from "./ChatPane";
import { useWorkbench } from "../store/workbench";

const assistantMessage = {
  id: 9,
  novel_id: 1,
  role: "assistant" as const,
  content: "第一章",
  mode: "write",
  model: "MiniMax-M2.5",
  mentions: [],
  context_refs: [],
  token_input: 1200,
  token_output: 340,
  created_at: "2026-09-01T10:00:00Z",
};

function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function sse(events: [string, unknown][]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [event, data] of events) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("ChatPane", () => {
  beforeEach(() => {
    useWorkbench.setState({
      selectedNovelId: 1,
      selectedChapterId: null,
      llmStatus: {
        provider: "openai_compatible",
        configured: true,
        models: { chat: true },
        available_models: ["MiniMax-M2.5"],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the streamed reply and its token detail", async () => {
    const user = userEvent.setup();
    const contextEvent: [string, unknown] = [
      "context",
      {
        items: [{ kind: "character", label: "人物 · 陈九思", ref: "character:3", score: 240 }],
        unknown_mentions: [],
        mode: "write",
        temperature: 0.7,
      },
    ];
    const calls: { model: string | null; mode: string; content: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          calls.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            sse([
              contextEvent,
              ["delta", { text: "第一" }],
              ["delta", { text: "章" }],
              ["done", { message: assistantMessage }],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(<ChatPane />);

    await user.type(screen.getByLabelText("对话输入"), "开场怎么写？");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("第一章")).toBeTruthy();
    });
    expect(screen.getByText("我")).toBeTruthy();
    expect(calls[0].content).toBe("开场怎么写？");
    expect(calls[0].mode).toBe("write");
    expect(calls[0].model).toBeNull();

    await user.click(screen.getByText(/1\.2k in/));
    await waitFor(() => {
      expect(screen.getByText(/输入 1200 \/ 输出 340/)).toBeTruthy();
    });
    expect(screen.getByText("人物 · 陈九思")).toBeTruthy();
  });

  it("offers reference candidates while typing an @mention", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/context")) {
          return json([
            {
              kind: "character",
              label: "人物 · 陈九思",
              ref: "character:3",
              mention: "@人物:陈九思",
            },
          ]);
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(<ChatPane />);

    const box = screen.getByLabelText("对话输入") as HTMLTextAreaElement;
    await user.type(box, "@陈");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /陈九思/ })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: /陈九思/ }));

    await waitFor(() => {
      expect(box.value).toBe("@人物:陈九思 ");
    });
  });

  it("shows an error card and retries the same question", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          attempts += 1;
          if (attempts === 1) {
            return Promise.resolve(
              new Response(JSON.stringify({ detail: "LLM 未配置" }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
          return Promise.resolve(
            sse([
              ["context", { items: [], unknown_mentions: [], mode: "write", temperature: 0.7 }],
              ["delta", { text: "好的" }],
              ["done", { message: { ...assistantMessage, content: "好的" } }],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(<ChatPane />);

    await user.type(screen.getByLabelText("对话输入"), "还在吗");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("LLM 未配置")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.getByText("好的")).toBeTruthy();
    });
    expect(attempts).toBe(2);
    // Retry reuses the failed turn instead of stacking a second question bubble.
    expect(screen.getAllByText("还在吗")).toHaveLength(1);
  });

  it("stacks the dock the way frame 14 draws it: field first, tools below", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json([])));
    const { container } = render(<ChatPane />);

    let field!: HTMLElement;
    await waitFor(() => {
      const dock = container.querySelector(".chat-dock") as HTMLElement;
      const input = dock.querySelector(".chat-input");
      if (!input) throw new Error("dock not mounted");
      field = input as HTMLElement;
    });
    const tools = container.querySelector(".chat-dock .chat-toolbar") as HTMLElement;
    expect(field).toBeTruthy();
    expect(tools).toBeTruthy();
    expect(field.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The send button belongs to the field row, and the context line is not a
    // third dock row — frame 14's dock is two rows tall.
    expect(field.querySelector(".chat-send")).toBeTruthy();
    expect(container.querySelector(".chat-dock .chat-context")).toBeNull();
    expect(container.querySelector(".chat-pane > .chat-context")).toBeTruthy();
  });
});
