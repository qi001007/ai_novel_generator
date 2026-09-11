import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatPane from "./ChatPane";
import { toolLine } from "./chatRows";
import { draftDocument, useFiles } from "../store/files";
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

  /* 批注 35.29b（D-56）：主人裁定「确认」不在「要不要把正文放进渲染页」这一头，而在定稿入库
     那一头——「你这个确认就很没有意义」。这颗按钮守的那条路本来就逐字流式
     （workbench.ts:464-500 每个 delta 直接 setDraft），它从来没有挡住任何东西。 */
  const fileDoc = (text: string, revision: string) => ({
    path: "chapters/0001/draft.md",
    kind: "draft",
    layer: "D",
    label: "正文",
    text,
    ai_fields: [],
    revision,
  });

  it("批注 35.29b：生成一章不用先点确认，正文随 delta 一个字一个字长进正文页", async () => {
    const user = userEvent.setup();
    const streamed = "意识恢复的瞬间，疼痛也跟着回来了。";
    // 与真机一致：选中作品时文件层 store 就 attach 上了（ChatPaneProposal.test.tsx 同一做法），
    // 否则 applyProposal / reload 在 novelId 为 null 时直接返回，测的就不是跑的那条路。
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
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
        return Promise.resolve(sse([
          ["delta", { text: "意识恢复的" }],
          ["delta", { text: "瞬间，疼痛也跟着回来了。" }],
          ["done", { chapter: { id: 7, novel_id: 1, brief_id: 8, chapter_number: 1, title: "第一章", content: streamed, word_count: streamed.length, status: "draft", final_decision: "", final_comment: "" }, generation_run: { id: 12 }, machine_check: { passed: true, word_count: streamed.length, issues: [] } }],
          ["end", {}],
        ]));
      }
      if (url.includes("/files/chapters/0001/draft.md")) return json(fileDoc(draftDocument(1, streamed), "r2"));
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    // 判据①：选了章节也不许再出现这颗确认，三种节点各数一遍
    expect(screen.queryByRole("button", { name: "确认并生成正文" })).toBeNull();
    expect(screen.queryByText("确认并生成")).toBeNull();
    expect(document.querySelector(".chat-generate-confirm")).toBeNull();

    // 判据②：命令本身就是那一次发起，全程零点击；正文页缓冲随 delta 单调变长
    const growth: number[] = [];
    const stop = useFiles.subscribe((state) => {
      const next = state.entries["chapters/0001/draft.md"]?.draft.length ?? 0;
      if (growth[growth.length - 1] !== next) growth.push(next);
    });
    await user.type(screen.getByLabelText("对话输入"), "/generate 1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(urls.some((url) => url.includes("/chapters/from-brief/8/stream"))).toBe(true));
    await waitFor(() =>
      expect(useFiles.getState().entries["chapters/0001/draft.md"]?.draft).toContain(streamed),
    );
    stop();
    expect(screen.getAllByText("/generate").length).toBeGreaterThan(0);
    const rising = growth.filter((length) => length > 0);
    expect(rising.length).toBeGreaterThanOrEqual(2);
    expect(rising.every((length, index) => index === 0 || length > rising[index - 1])).toBe(true);
  });

  /* 另一路：模型在回答里自己写 `​```markdown @chapters/0001/draft.md`（D-54 立的落点）。
     今天它挂一张卡等一次「应用」；按 D-56 这一份直接落进那一章，卡不再出现。 */
  it("批注 35.29b：整章正文的围栏不挂卡、不等点击，直接写进那一章的 draft.md", async () => {
    const user = userEvent.setup();
    const fence = "```markdown @chapters/0001/draft.md\n意识恢复的瞬间，疼痛也跟着回来了。\n```";
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    const proposed = draftDocument(1, "意识恢复的瞬间，疼痛也跟着回来了。");
    const writes: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        writes.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return json({ path: "chapters/0001/draft.md", changed: ["content"], revision: "r2" });
      }
      if (url.includes("/chat/stream")) {
        return Promise.resolve(sse([
          ["context", { items: [], unknown_mentions: [], mode: "write", temperature: 0.7 }],
          ["delta", { text: `写完了。\n\n${fence}` }],
          ["proposal", { path: "chapters/0001/draft.md", text: proposed, valid: true, error: null }],
          ["done", { message: stored(`写完了。\n\n${fence}`) }],
          ["end", {}],
        ]));
      }
      if (url.includes("/files/chapters/0001/draft.md")) return json(fileDoc(draftDocument(1, "旧稿"), "r1"));
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "把第 1 章写完整");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0].url).toBe("/api/novels/1/files/chapters/0001/draft.md");
    expect(writes[0].body).toMatchObject({ actor: "ai", text: proposed, base_revision: "r1" });
    // 不挂卡：这张卡的任何一个部件都不许在屏幕上
    expect(document.querySelector(".proposal-file")).toBeNull();
    expect(document.querySelector(".proposal-btn")).toBeNull();
    // 35.21 的另一半仍然成立：摘围栏靠渲染，不靠这张卡在不在
    const bubble = document.querySelector(".chat-card.agent");
    expect(bubble?.textContent).toContain("写完了。");
    expect(bubble?.textContent).not.toContain("```markdown");
    expect(bubble?.textContent).not.toContain("意识恢复的瞬间");
  });

  /* D-56 那道守卫得有行为钉着，不能只在源码串里出现一次：刷新恢复的那一次生成早就落过盘，
     此刻再写一遍会盖掉主人之后在正文页框选改的字。所以历史里的 draft 围栏只回卡片，不落笔。 */
  it("批注 35.29b：刷新恢复只把卡片挂回去，不再写第二遍那一章的 draft.md", async () => {
    const proposed = draftDocument(1, "意识恢复的瞬间，疼痛也跟着回来了。");
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    useWorkbench.setState({ selectedNovelId: 1, selectedChapterId: null } as never);
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        writes.push(url);
        return json({ path: "chapters/0001/draft.md", changed: ["content"], revision: "r2" });
      }
      if (url.includes("/chat/messages")) {
        return json([{
          ...assistantMessage,
          proposals: [{ path: "chapters/0001/draft.md", text: proposed, valid: true, error: "" }],
        }]);
      }
      if (url.includes("/files/chapters/0001/draft.md")) return json(fileDoc(draftDocument(1, "主人改过的稿子"), "r3"));
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    // 卡片回来了：35.22 那条裁定（刷新后卡片在、页签不动）不被 29b 推翻
    await waitFor(() => expect(document.querySelector(".proposal-file")).toBeTruthy());
    expect(document.querySelector(".proposal-file")?.textContent).toContain("chapters/0001/draft.md");
    expect(writes).toEqual([]);
  });

  /* 批注 35.29c（D-57）：主人「经常容易忘记生成简章」，所以缺简报那一章不再被推回去自己补——
     /generate 先自己发一句补简报，那一份一落地就自动接着写正文。两份 fixture 与真机同形状。 */
  const chapterOneRow = {
    id: 7,
    novel_id: 1,
    brief_id: null,
    chapter_number: 1,
    title: "第一章",
    content: "",
    word_count: 0,
    status: "draft" as const,
    final_decision: "",
    final_comment: "",
  };
  const briefRowOne = {
    id: 8,
    novel_id: 1,
    arc_plan_id: null,
    chapter_number: 1,
    goal: "确认意识的代价",
    events: "苏醒",
    pov: "陈九思",
    characters: [],
    conflict: "",
    hook: "",
    required_facts: [],
    status: "draft" as const,
  };
  // 服务器那份是空模板，围栏里是填好的：两者逐字相同会被「已原样落过盘」那道判断摘掉，
  // 测的就不是落笔那一步了。
  const briefProposed = "# 第 1 章简报（D 层 · 单章简报）\n\n## 本章目标\n\n确认意识的代价\n";
  const briefDocOne = {
    path: "chapters/0001/brief.md",
    kind: "brief",
    layer: "D",
    label: "简报",
    text: "# 第 1 章简报（D 层 · 单章简报）\n\n## 本章目标\n\n\n",
    ai_fields: [],
    revision: "r1",
  };

  it("批注 35.29c：/generate 缺简报时先补简报，简报一落地就自动接着写正文", async () => {
    const user = userEvent.setup();
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    useWorkbench.setState({
      selectedNovelId: 1,
      selectedChapterId: chapterOneRow.id,
      chapters: [chapterOneRow],
      briefs: [],
    });
    const urls: string[] = [];
    const writes: string[] = [];
    let briefAsk = "";
    // 那一行随后还要被改两次，所以把这一轮流压住，先读到它此刻说的话再放行
    let releaseStream = () => {};
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      urls.push(url);
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        writes.push(url);
        return json({ path: "chapters/0001/brief.md", changed: ["goal"], revision: "r2" });
      }
      if (url.includes("/chat/stream")) {
        briefAsk = String(JSON.parse(String(init?.body)).content);
        return streamGate.then(() =>
          sse([
            ["context", { items: [], unknown_mentions: [], mode: "plan", temperature: 0.7 }],
            ["delta", { text: "这一章的简报已给出。" }],
            ["proposal", { path: "chapters/0001/brief.md", text: briefProposed, valid: true, error: null }],
            ["done", { message: stored("这一章的简报已给出。") }],
            ["end", {}],
          ]),
        );
      }
      if (url.includes("/chapters/from-brief/8/stream")) {
        return Promise.resolve(sse([
          ["delta", { text: "意识恢复的瞬间。" }],
          ["done", {
            chapter: { ...chapterOneRow, brief_id: 8, content: "意识恢复的瞬间。", word_count: 8 },
            generation_run: { id: 12 },
            machine_check: { passed: true, word_count: 8, issues: [] },
          }],
          ["end", {}],
        ]));
      }
      if (url.includes("/files/chapters/0001/brief.md")) return json(briefDocOne);
      if (url.endsWith("/planning/briefs")) return json([briefRowOne]);
      if (url.endsWith("/api/novels/1/chapters")) return json([{ ...chapterOneRow, brief_id: 8 }]);
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/generate");
    await user.keyboard("{Enter}");

    // ①那一句是替主人发的：点名这一章、走工具那唯一编译器，而且不显示成他说的话
    await waitFor(() => expect(urls.some((item) => item.includes("/chat/stream"))).toBe(true));
    expect(briefAsk).toContain("第 1 章《第一章》还没有 D 层简报");
    expect(briefAsk).toContain("propose_chapter_brief");
    // 那一步要说清接下来会发生什么，不是只报一个原因
    expect(screen.getByText(/先补简报，它一落地就自动接着写正文/)).toBeTruthy();
    expect(screen.queryByText(/还没有 D 层简报。/)).toBeNull();
    releaseStream();

    // ②本轮那一份简报不挂卡、不等点击，写仍只有那一条 PUT
    await waitFor(() => expect(writes).toEqual(["/api/novels/1/files/chapters/0001/brief.md"]));
    expect(document.querySelector(".proposal-file")).toBeNull();

    // ③简报真的进了 store，正文这一步才自己接上；结算仍走同一处
    await waitFor(() =>
      expect(urls.some((item) => item.includes("/chapters/from-brief/8/stream"))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByText(/第 1 章《第一章》· 8 字 · 机械校验 通过/)).toBeTruthy(),
    );
  });

  /* 那道口子有多窄，用反面钉住：不是 /generate 接力点名的那一轮，简报照样只挂一张卡。 */
  it("批注 35.29c：平时要简报的那一轮仍然只挂卡，不动笔", async () => {
    const user = userEvent.setup();
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    useWorkbench.setState({ selectedNovelId: 1, selectedChapterId: null, chapters: [], briefs: [] });
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        writes.push(url);
        return json({ path: "chapters/0001/brief.md", changed: ["goal"], revision: "r2" });
      }
      if (url.includes("/chat/stream")) {
        return Promise.resolve(sse([
          ["delta", { text: "简报写好了。" }],
          ["proposal", { path: "chapters/0001/brief.md", text: briefProposed, valid: true, error: null }],
          ["done", { message: stored("简报写好了。") }],
          ["end", {}],
        ]));
      }
      if (url.includes("/files/chapters/0001/brief.md")) return json(briefDocOne);
      return Promise.resolve(json([]));
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "给第 1 章写一份 D 层简报");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(document.querySelector(".proposal-file")).toBeTruthy());
    expect(document.querySelector(".proposal-file")?.textContent).toContain("chapters/0001/brief.md");
    expect(writes).toEqual([]);
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

  it("says on the answer which mode the sentence used, and the readout lights that same one", async () => {
    await runTurn("plan");
    expect(document.querySelector(".chat-card .chat-mode")?.textContent).toBe("按「计划」");
    // 批注 35.28（方案 1）：原先这里钉的是「开关仍显示主人拨的那一侧」——两颗各说一套，
    // 于是「我点了写作却被改成计划」永远看得见、永远改不掉。现在只有一个答案：
    // 点亮的那一侧就是最近一答实际用的那一侧，与上面那颗标签同源。
    expect(document.querySelector(".mode-switch button.selected")?.textContent).toBe("计划");
  });

  it("批注 35.28：那两颗是状态栏，点它不改任何东西", async () => {
    const user = userEvent.setup();
    await runTurn("plan");
    const readouts = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".mode-switch button"),
    );
    expect(readouts.map((node) => node.textContent)).toEqual(["计划", "写作"]);
    for (const node of readouts) {
      // 判据逐条：role 不为 radio、aria-disabled 为真，且真的点不动（disabled 不带入 Tab 序）
      expect(node.getAttribute("role")).toBeNull();
      expect(node.getAttribute("aria-disabled")).toBe("true");
      expect(node.disabled).toBe(true);
    }
    await user.click(readouts[1]);
    expect(document.querySelector(".mode-switch button.selected")?.textContent).toBe("计划");
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

  /* 批注 35.34（真机量到的形状：`.scratch/g3529c.mjs`，作品 6 副本库 3529c.db）：
     一次 /generate 全程，卡片上那三段文案在屏上逐字可见；Page.reload 之后
     .chat-card.command **0 张**，而它替人做的事全在（简报 1 份、正文 56 字、答案气泡 18 字仍在）
     ——结果留痕、过程不留痕。下面三条钉的是补上的那一半：刷新回来的还是那一张卡、
     卡上的那一句逐字等于结算那一刻屏上的那一句、接力结算两次库里仍只有一行。 */
  const settledDetail = "第 1 章《第一章》· 56 字 · 机械校验 通过";
  const commandMessageRow = {
    id: 21,
    novel_id: 1,
    conversation_id: 1,
    role: "command" as const,
    content: settledDetail,
    reasoning: "",
    mode: "",
    model: "",
    mentions: [],
    context_refs: [],
    steps: [],
    command_state: { command: "/generate", status: "done", run_id: 12, chapter_id: 7 },
    token_input: 0,
    token_output: 0,
    created_at: "2026-09-11T06:00:00Z",
  };
  const plainUserRow = {
    id: 20,
    novel_id: 1,
    conversation_id: 1,
    role: "user" as const,
    content: "写第 1 章",
    reasoning: "",
    mode: "write",
    model: "",
    mentions: [],
    context_refs: [],
    steps: [],
    token_input: 0,
    token_output: 0,
    created_at: "2026-09-11T05:59:00Z",
  };

  it("批注 35.34：刷新回来那条命令还在，说的是结算那一份，也不多出一个气泡", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/chat/messages")) return json([plainUserRow, commandMessageRow]);
      return json([]);
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await waitFor(() => expect(document.querySelectorAll(".chat-card.command")).toHaveLength(1));

    const card = document.querySelector(".chat-card.command") as HTMLElement;
    // 判据逐字：detail 就是刷新前那一份，不是重新拼的
    expect(card.querySelector("p")?.textContent).toBe(settledDetail);
    expect(card.querySelector("code")?.textContent).toBe("/generate");
    // 状态是最后一次结算的那一份，不是运行中：没有圈，写着「完成」
    expect(card.className).toContain("done");
    expect(card.querySelector(".chat-state")?.textContent).toBe("完成");
    expect(card.querySelector(".spinner")).toBeNull();
    // 两个跳转按钮跟着回来（run_id／chapter_id 也落库了）
    expect(screen.getByLabelText("查看调用详情")).toBeTruthy();
    expect(screen.getByLabelText("在正文打开")).toBeTruthy();
    // 「不许因此多出第二个气泡」：那一条 user 仍是唯一的气泡，命令行没扮成答复
    expect(document.querySelectorAll(".chat-bubble")).toHaveLength(1);
    expect(document.querySelectorAll(".chat-message")).toHaveLength(1);
  });

  it("批注 35.34：命令结算的那一刻落一次库，落的就是屏上那一句", async () => {
    const user = userEvent.setup();
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    useWorkbench.setState({
      selectedChapterId: 7,
      chapters: [{ id: 7, novel_id: 1, brief_id: 8, chapter_number: 1, title: "第一章", content: "", word_count: 0, status: "draft", final_decision: "", final_comment: "" }],
      briefs: [{ id: 8, novel_id: 1, arc_plan_id: null, chapter_number: 1, goal: "推进", events: "相遇", pov: "主角", characters: [], conflict: "", hook: "", required_facts: [], status: "ready" }],
    });
    const posts: Record<string, unknown>[] = [];
    const streamed = "意识恢复的瞬间，疼痛也跟着回来了。";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/chat/commands")) {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({ id: 41 });
      }
      if (url.includes("/chapters/from-brief/8/stream")) {
        return Promise.resolve(sse([
          ["delta", { text: streamed }],
          ["done", { chapter: { id: 7, novel_id: 1, brief_id: 8, chapter_number: 1, title: "第一章", content: streamed, word_count: streamed.length, status: "draft", final_decision: "", final_comment: "" }, generation_run: { id: 12 }, machine_check: { passed: true, word_count: streamed.length, issues: [] } }],
          ["end", {}],
        ]));
      }
      if (url.includes("/files/chapters/0001/draft.md")) return json(fileDoc(draftDocument(1, streamed), "r2"));
      return json([]);
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/generate 1");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(posts).toHaveLength(1));
    const card = document.querySelector(".chat-card.command") as HTMLElement;
    // 落库的那一份与屏上的那一份逐字相同，不是各写一遍文案
    expect(posts[0].detail).toBe(card.querySelector("p")?.textContent);
    expect(posts[0]).toMatchObject({
      message_id: null,
      command: "/generate",
      status: "done",
      run_id: 12,
      chapter_id: 7,
    });
  });

  it("批注 35.34：简报接力让同一张卡结算两次，库里仍只有一行", async () => {
    const user = userEvent.setup();
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    useWorkbench.setState({
      selectedNovelId: 1,
      selectedChapterId: chapterOneRow.id,
      chapters: [chapterOneRow],
      briefs: [],
    });
    const posts: Record<string, unknown>[] = [];
    let releaseStream = () => {};
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        return json({ path: "chapters/0001/brief.md", changed: ["goal"], revision: "r2" });
      }
      if (url.includes("/chat/commands")) {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({ id: 41 });
      }
      if (url.includes("/chat/stream")) {
        return streamGate.then(() => sse([
          ["context", { items: [], unknown_mentions: [], mode: "plan", temperature: 0.7 }],
          ["delta", { text: "这一章的简报已给出。" }],
          ["proposal", { path: "chapters/0001/brief.md", text: briefProposed, valid: true, error: null }],
          ["done", { message: stored("这一章的简报已给出。") }],
          ["end", {}],
        ]));
      }
      if (url.includes("/chapters/from-brief/8/stream")) {
        return Promise.resolve(sse([
          ["delta", { text: "意识恢复的瞬间。" }],
          ["done", {
            chapter: { ...chapterOneRow, brief_id: 8, content: "意识恢复的瞬间。", word_count: 8 },
            generation_run: { id: 12 },
            machine_check: { passed: true, word_count: 8, issues: [] },
          }],
          ["end", {}],
        ]));
      }
      if (url.includes("/files/chapters/0001/brief.md")) return json(briefDocOne);
      if (url.endsWith("/planning/briefs")) return json([briefRowOne]);
      if (url.endsWith("/api/novels/1/chapters")) return json([{ ...chapterOneRow, brief_id: 8 }]);
      return json([]);
    }));

    render(<MemoryRouter><ChatPane /></MemoryRouter>);
    await user.type(screen.getByLabelText("对话输入"), "/generate");
    await user.keyboard("{Enter}");

    // 第一次结算：这一张卡要去补简报
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].message_id).toBeNull();
    expect(posts[0].status).toBe("done");
    releaseStream();
    // 第二次结算：正文真的写完了，改写的是同一行
    await waitFor(() => expect(posts).toHaveLength(2), { timeout: 4000 });
    expect(posts[1].message_id).toBe(41);
    expect(posts[1].detail).toBe("第 1 章《第一章》· 8 字 · 机械校验 通过");
    // 屏上仍是一张卡：两次结算改写的是同一行
    expect(document.querySelectorAll(".chat-card.command")).toHaveLength(1);
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
