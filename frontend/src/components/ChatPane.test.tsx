import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatPane from "./ChatPane";
import { toolLine } from "./chatRows";
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
  steps: [],
  token_input: 1200,
  token_output: 340,
  reasoning: "",
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

  it("requires an explicit confirmation before starting chapter generation", async () => {
    const user = userEvent.setup();
    useWorkbench.setState({
      selectedChapterId: 7,
      briefs: [{ id: 8, novel_id: 1, arc_plan_id: null, chapter_number: 1, goal: "推进", events: "相遇", pov: "主角", characters: [], conflict: "", hook: "", required_facts: [], status: "ready" }],
      chapters: [{ id: 7, novel_id: 1, brief_id: 8, chapter_number: 1, title: "第一章", content: "", word_count: 0, status: "draft", final_decision: "", final_comment: "" }],
    });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      urls.push(url);
      if (url.includes("/chapters/from-brief/8/stream")) {
        return Promise.resolve(sse([["done", { chapter: { id: 7, novel_id: 1, brief_id: 8, chapter_number: 1, title: "第一章", content: "正文", word_count: 2, status: "draft", final_decision: "", final_comment: "" }, generation_run: { id: 12 }, machine_check: { passed: true, word_count: 2, issues: [] } }], ["end", {}]]));
      }
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "确认并生成正文" }));
    await waitFor(() => expect(urls.some((url) => url.includes("/chapters/from-brief/8/stream"))).toBe(true));
    expect(screen.getAllByText("/generate").length).toBeGreaterThan(0);
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

  /* 批注 35.15：D-41 之后这一轮的模式由那句话裁定，composer 那个开关只是「下一句拨到哪」。
     所以答案行必须自己说清这一答按什么办的——判据两种模式各要一行断言。 */
  async function runTurn(effective: "plan" | "write") {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([
              ["context", { items: [], unknown_mentions: [], mode: effective, temperature: 0.7 }],
              ["delta", { text: "第一章" }],
              ["done", { message: { ...assistantMessage, mode: effective } }],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "给第 1 章写一份简报");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(document.querySelector(".chat-card .chat-mode")).toBeTruthy();
    });
  }

  it("says on the answer which mode the sentence used, while the dial stays where it was put", async () => {
    await runTurn("plan");
    expect(document.querySelector(".chat-card .chat-mode")?.textContent).toBe("按「计划」");
    // 开关仍显示主人拨的那一侧：它说的是下一句的起点，不是这一答的结论，两处不互相矛盾。
    expect(screen.getByRole("radio", { name: "写作" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "计划" }).getAttribute("aria-checked")).toBe("false");
  });

  it("says 按「写作」 on the answer when the sentence really asked for prose", async () => {
    await runTurn("write");
    expect(document.querySelector(".chat-card .chat-mode")?.textContent).toBe("按「写作」");
  });

  /* 第十六批批注 1: 「智能体回话的上面还是没有思考过程展开的入口」. The fold that was
     there only ever listed tool calls, so an ordinary answer had no entry at all. */
  /* 第十九批批注 1: the paperclip used to be disabled because the old picker threw the
     selection away. It now has to carry the file to the model and look like the chip the
     owner drew - and refuse a wrong file out loud. */
  async function openWithStream(onStream: (body: unknown) => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/chat/stream")) {
          onStream(JSON.parse(String(init?.body)));
          return Promise.resolve(sse([["delta", { text: "好" }], ["end", {}]]));
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
  }

  it("shows a removable chip for a picked file and sends its text", async () => {
    const bodies: unknown[] = [];
    await openWithStream((body) => bodies.push(body));
    const user = userEvent.setup();

    await user.upload(
      document.querySelector(".chat-attach-input") as HTMLInputElement,
      [new File(["碑律第一条：不可靠近碑面。"], "AGENTS.md", { type: "text/markdown" })],
    );

    const chip = await screen.findByLabelText("已选附件");
    expect(chip.textContent).toContain("AGENTS.md");

    await user.type(screen.getByLabelText("对话输入"), "按这份设定检查");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toMatchObject({
      attachments: [{ name: "AGENTS.md", text: "碑律第一条：不可靠近碑面。" }],
    });
    // and the chip is gone once the turn actually went out
    await waitFor(() => expect(screen.queryByLabelText("已选附件")).toBeNull());
  });

  it("drops a chip on its own remove button", async () => {
    await openWithStream(() => undefined);
    const user = userEvent.setup();
    await user.upload(
      document.querySelector(".chat-attach-input") as HTMLInputElement,
      [new File(["a"], "one.txt"), new File(["b"], "two.txt")],
    );
    expect((await screen.findByLabelText("已选附件")).textContent).toContain("two.txt");
    await user.click(screen.getByRole("button", { name: "移除附件 one.txt" }));
    const chip = await screen.findByLabelText("已选附件");
    expect(chip.textContent).not.toContain("one.txt");
    expect(chip.textContent).toContain("two.txt");
  });

  it("refuses a non-text file with a reason instead of silently ignoring it", async () => {
    await openWithStream(() => undefined);
    const input = document.querySelector(".chat-attach-input") as HTMLInputElement;
    // userEvent.upload honours the accept attribute, so a wrong type has to be pushed
    // in by hand - that is the point of the check: the browser filter is courtesy, the
    // component still has to refuse when something slips past it.
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([137, 80, 78, 71])], "cover.png", { type: "image/png" })],
    });
    fireEvent.change(input);
    expect(await screen.findByText(/cover\.png/)).toBeTruthy();
    expect(screen.queryByLabelText("已选附件")).toBeNull();
  });

  it("folds the model's own reasoning above the answer and opens it on click", async () => {
    const user = userEvent.setup();
    const thought = "先翻目录确认第 1 章的落点，再决定用谁的视角开场。";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([
              ["delta", { text: "第一章" }],
              ["done", { message: { ...stored("第一章"), reasoning: thought } }],
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
    await screen.findByText("第一章");

    const entry = screen.getByRole("button", { name: /思考过程/ });
    // folded by default: the entry is there, the text is not
    expect(screen.queryByText(thought)).toBeNull();
    expect(entry.getAttribute("aria-expanded")).toBe("false");
    await user.click(entry);
    expect(await screen.findByText(thought)).toBeTruthy();
    expect(entry.getAttribute("aria-expanded")).toBe("true");
  });

  /* 第二十九批批注 6（2026-09-07）：思考过程要**先于**正文流出来。以前 SSE 里根本没有
     这一路，推理只在 done 里出现一次，所以它永远比正文晚 - 他看到的就是那个顺序。
     上面那条测的是「答完之后默认收起」，这一条测的是「正在想的时候它就得在屏上」。 */
  it("streams the reasoning onto the screen before the prose starts", async () => {
    const user = userEvent.setup();
    const thought = "先看第 4 章的简报，再决定从哪儿接。";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([
              ["reasoning", { text: "先看第 4 章的简报，" }],
              ["reasoning", { text: "再决定从哪儿接。" }],
              ["delta", { text: "正文第一段" }],
              [
                "done",
                { message: { ...stored("正文第一段"), reasoning: thought } },
              ],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "续写第四章");
    await user.keyboard("{Enter}");

    const line = await screen.findByText(thought);
    // 它站在思考过程那一块里，不是正文（两块的字必须能分开，见 §0.9）
    expect(line.closest(".chat-thinking-body")).toBeTruthy();
    // 流式期间就展开着：默认收起等于把「看着它想」又变回答完才给
    expect(
      screen.getByRole("button", { name: /思考过程/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    // 顺序：思考过程那块排在正文之前，不是答完补在最后
    const card = line.closest(".chat-card") as HTMLElement;
    const prose = card.querySelector(".chat-md") as HTMLElement;
    expect(
      Boolean(line.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  /* 第二十九批批注 4（2026-09-07）：开场白那句「不要用正文字体，用那种思考状态的字体」。
     它不是 Agent 答的话，是一句界面提示，所以套思考那张脸；而**真答的正文不许跟着变**。 */
  it("sets the greeting with the thinking face and leaves real answers in prose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    const line = await screen.findByText(/我是这本书的写作 Agent/);
    expect(line.closest(".chat-greeting")).toBeTruthy();
    // 它仍然是从 .chat-md 渲染出来的，只是多挂了一个类 - 不改排版结构
    expect(line.closest(".chat-md")).toBeTruthy();
  });

  /* 批注 31.4「工具轨迹刷新后消失」：那一列从前只活在流上，页面一刷就只剩一个
     点开却永远为空的折叠。现在步骤跟着那条答复落库，历史用同一个 toolLine 渲染。 */
  it("puts the tool trace back when the answer is read from history", async () => {
    const steps = [
      { step: 1, name: "read_file", arguments: { path: "toc.md" }, ok: false, ms: 12, chars: 234 },
      { step: 2, name: "propose_toc", arguments: { payload: "{}" }, ok: true, ms: 1400, chars: 541 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/messages")) return json([{ ...assistantMessage, steps }]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await screen.findByText("第一章");

    fireEvent.click(screen.getByRole("button", { name: /1\.2k in/ }));
    const heads = [...document.querySelectorAll(".chat-detail-line")].map((p) => p.textContent);
    const lines = [...document.querySelectorAll(".chat-trace-row")].map((li) => li.textContent);

    // 判据是「逐字相同」，不是「有东西」：这一列由流式那一个 toolLine 渲染，没有第二份文案。
    expect(lines).toEqual(steps.map(toolLine));
    expect(heads).toContain("本轮读取 · 2 步");
    expect(lines[0]).toContain("未成功");
    expect(lines[1]).toContain("1.4s");
  });

  it("shows no thinking entry when the model gave no reasoning", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([["delta", { text: "第一章" }], ["done", { message: stored("第一章") }], ["end", {}]]),
          );
        }
        if (url.includes("/chat/messages")) return json([]);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      }),
    );
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "开场怎么写？");
    await user.keyboard("{Enter}");
    await screen.findByText("第一章");
    // no empty shell: an entry that opens onto nothing is the假控件 this project bans
    expect(screen.queryByRole("button", { name: /思考过程/ })).toBeNull();
  });

  /* 第九批遗留：这条提示一直在教主人做一件错事（改 .env 并重启后端），
     而 D-16 之后真源是 app_config 表、入口在 /settings。 */
  it("points the unconfigured notice at the settings page, not at backend/.env", async () => {
    useWorkbench.setState({
      llmStatus: {
        provider: "openai_compatible",
        configured: false,
        models: {},
        available_models: [],
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json([]))));
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    const notice = await screen.findByText(/LLM 未配置/);
    expect(notice.textContent).toContain("设置");
    expect(notice.textContent).toContain("不用重启后端");
    // the wrong instruction must not come back: editing the file and restarting.
    // (Checked as a phrase - the correct sentence also contains 重启, in 「不用重启后端」.)
    expect(notice.textContent).not.toMatch(/\.env/);
    expect(notice.textContent).not.toMatch(/密钥后重启|后重启后端/);
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
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
    // 批注 3, 4: no header row above the answer any more; what is left of the
    // speaker line is the model, and it lives beside the icons.
    expect(card?.querySelector(".chat-card-head")).toBeNull();
    expect(card?.querySelector(".chat-actions .chat-who")?.textContent).toBe("MiniMax-M2.5");
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

    await user.click(screen.getByRole("button", { name: "重试这一问" }));

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
              ["tool", { step: 1, name: "web_search", arguments: { query: "司天监" }, ok: true, ms: 1400, chars: 1234 }],
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
      // 标题说一次共几步，每一行自己带着代价（§六 第 2 步判据 31.1）
      expect(screen.getByText("本轮读取 · 1 步")).toBeTruthy();
      expect(screen.getByText("第 1 步 · web_search 司天监 · 1.4s · 1.2k 字")).toBeTruthy();
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

  // 批注 35.30：/generate 后面到底跟什么，界面上原先任何地方都查不到。
  const chapterOne = { id: 7, novel_id: 1, brief_id: 8, chapter_number: 1, title: "第一章", content: "", word_count: 0, status: "draft" as const, final_decision: "", final_comment: "" };
  const chapterTwo = { id: 9, novel_id: 1, brief_id: 10, chapter_number: 2, title: "第二章", content: "", word_count: 0, status: "draft" as const, final_decision: "", final_comment: "" };
  const briefOf = (id: number, chapterNumber: number) => ({ id, novel_id: 1, arc_plan_id: null, chapter_number: chapterNumber, goal: "推进", events: "相遇", pov: "主角", characters: [], conflict: "", hook: "", required_facts: [], status: "ready" as const });

  it("generates the chapter named by the /generate argument", async () => {
    const user = userEvent.setup();
    useWorkbench.setState({
      selectedChapterId: chapterOne.id,
      chapters: [chapterOne, chapterTwo],
      briefs: [briefOf(8, 1), briefOf(10, 2)],
    });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      urls.push(url);
      if (url.includes("/chapters/from-brief/10/stream")) {
        return Promise.resolve(sse([
          ["done", { chapter: { ...chapterTwo, content: "正文", word_count: 2 }, generation_run: { id: 12 }, machine_check: { passed: true, word_count: 2, issues: [] } }],
          ["end", {}],
        ]));
      }
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/generate 2");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(urls.some((url) => url.includes("/chapters/from-brief/10/stream"))).toBe(true));
    expect(urls.some((url) => url.includes("/chapters/from-brief/8/stream"))).toBe(false);
    expect(useWorkbench.getState().selectedChapterId).toBe(chapterTwo.id);
  });

  it("tells what to type next when /generate has no chapter in scope", async () => {
    const user = userEvent.setup();
    useWorkbench.setState({
      selectedChapterId: null,
      chapters: [chapterOne, chapterTwo],
      briefs: [briefOf(8, 1), briefOf(10, 2)],
    });
    vi.stubGlobal("fetch", vi.fn(() => json([])));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/generate");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByText(/在左边点一章，或输入 \/generate 1 生成第 1 章/)).toBeTruthy(),
    );
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
