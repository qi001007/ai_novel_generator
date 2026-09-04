import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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

function stored(content: string) {
  // The done event overwrites the streamed text with the persisted row, so a test
  // that asserts on the answer has to put the same words in both places.
  return { ...assistantMessage, content };
}

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

    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await user.type(screen.getByLabelText("对话输入"), "开场怎么写？");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("第一章")).toBeTruthy();
    });
    // The avatar is gone (Codex layout: no faces, your row is the one on the right),
    // so what proves your own message is on screen is the text, in your row.
    expect(document.querySelector(".chat-row.user .chat-bubble")?.textContent).toBe(
      "开场怎么写？",
    );
    expect(document.querySelector(".chat-avatar")).toBeNull();
    expect(calls[0].content).toBe("开场怎么写？");
    expect(calls[0].mode).toBe("write");
    expect(calls[0].model).toBeNull();

    await user.click(screen.getByText(/1\.2k in/));
    await waitFor(() => {
      expect(screen.getByText(/输入 1200 \/ 输出 340/)).toBeTruthy();
    });
    expect(screen.getByText("人物 · 陈九思")).toBeTruthy();
  });

  it("renders the reply as prose and ends it with copy and download", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([
              ["delta", { text: "这样收束的**代价感**" }],
              ["done", { message: stored("这样收束的**代价感**") }],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "开场怎么写？");
    await user.keyboard("{Enter}");

    // The complaint, verbatim: `**代价感**` reached the screen as asterisks.
    await waitFor(() => expect(screen.getByText("代价感")).toBeTruthy());
    const card = document.querySelector(".chat-card.agent");
    expect(card?.querySelector("strong")?.textContent).toBe("代价感");
    expect(card?.textContent).not.toContain("**");
    // and a finished reply ends with what you can do with it
    expect(screen.getByRole("button", { name: "复制这条回复" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载为 .md" })).toBeTruthy();
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

    render(<MemoryRouter><ChatPane /></MemoryRouter>);

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

    render(<MemoryRouter><ChatPane /></MemoryRouter>);

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

  it("nests the dock as one floating composer card: field first, tools below", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json([])));
    const { container } = render(<MemoryRouter><ChatPane /></MemoryRouter>);

    let field!: HTMLElement;
    await waitFor(() => {
      const card = container.querySelector(".composer");
      const input = card?.querySelector(".chat-input");
      if (!input) throw new Error("composer not mounted");
      field = input as HTMLElement;
    });
    const tools = container.querySelector(".composer .chat-toolbar") as HTMLElement;
    expect(field.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Frame 24 moves the send button into the tools row, and every control
    // (mode, attach, model, send) now lives inside the single card.
    expect(tools.querySelector(".chat-send")).toBeTruthy();
    expect(tools.querySelector(".mode-switch")).toBeTruthy();
    expect(tools.querySelector(".model-pill")).toBeTruthy();
    expect(container.querySelector(".chat-context")).toBeNull();
  });


  it("runs /search through the agent and shows what the tool read", async () => {
    const user = userEvent.setup();
    const calls: { content: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          calls.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            sse([
              [
                "context",
                {
                  items: [],
                  unknown_mentions: [],
                  mode: "write",
                  temperature: 0.7,
                  tools: ["list_files", "read_file", "web_search"],
                },
              ],
              ["tool", { step: 1, name: "web_search", arguments: { query: "司天监" }, ok: true }],
              ["delta", { text: "司天监，官署名。" }],
              ["done", { message: stored("司天监，官署名。来源：中文维基百科") }],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/search 司天监");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(calls.length).toBe(1));
    // the command asks for the tool by name instead of pretending to search itself
    expect(calls[0].content).toContain("web_search");
    expect(calls[0].content).toContain("司天监");
    await waitFor(() => expect(screen.getByText(/司天监，官署名/)).toBeTruthy());

    await user.click(screen.getByText(/1\.2k in/));
    await waitFor(() => {
      expect(screen.getByText("本轮读取 · web_search(司天监)")).toBeTruthy();
    });
  });

  it("refuses /search with no word and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_input: RequestInfo | URL) => json([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/search");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText("用法：/search <要查的词>")).toBeTruthy());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/stream"))).toHaveLength(0);
  });

  it("says a round needed no tool rather than leaving the detail blank", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([
              [
                "context",
                {
                  items: [],
                  unknown_mentions: [],
                  mode: "write",
                  temperature: 0.7,
                  tools: ["list_files", "read_file", "web_search"],
                },
              ],
              ["delta", { text: "不用查。" }],
              ["done", { message: stored("不用查。") }],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "在吗");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("不用查。")).toBeTruthy());

    await user.click(screen.getByText(/1\.2k in/));
    await waitFor(() => {
      expect(screen.getByText(/可用工具 list_files \/ read_file \/ web_search/)).toBeTruthy();
    });
  });
});

