import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPane from "./ChatPane";
import { useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";

const OLD = "# A 层\nconstraints: 不可挪动皇朝命轨\n";
const NEW = "# A 层\nconstraints: 不可挪动凡人命轨\n";
/* 批注 35.31：气泡里摊着的那份整 JSON，与它对应的那一份提案已经逐字落到 toc.md 上了
   ——两边相等才会走 offerFromStream 的丢弃分支。 */
const TOC_JSON = [
  "我先给出目录：",
  "",
  "```json",
  '{"chapters":[{"number":1,"title":"苏醒"}]}',
  "```",
  "",
  "要不要我继续扩展？",
].join("\n");
const TOC_APPLIED = "# B 目录\n\n| 章 | 标题 |\n| --- | --- |\n| 1 | 苏醒 |\n";

const doc = {
  path: "blueprint.md",
  kind: "blueprint",
  layer: "A",
  label: "全书蓝图",
  text: OLD,
  ai_fields: ["constraints"],
  revision: "rev-1",
};

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

function sse(events: [string, unknown][]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const [event, data] of events) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const writes: unknown[][] = [];
let historyRows: unknown[] = [];
let streamDelta = "我改好了";
/** 服务器上的 toc.md 此刻是什么：与那份提案逐字相等＝已经应用过，走丢弃分支（批注 35.31）。 */
let tocOnServer = TOC_APPLIED;

describe("ChatPane proposals", () => {
  beforeEach(() => {
    writes.length = 0;
    historyRows = [];
    streamDelta = "我改好了";
    tocOnServer = TOC_APPLIED;
    useFiles.getState().reset();
    useFiles.setState({ novelId: 1 });
    useWorkbench.setState({
      selectedNovelId: 1,
      selectedChapterId: null,
      llmStatus: {
        provider: "openai_compatible",
        configured: true,
        models: { chat: true },
        available_models: ["MiniMax-M2.5"],
      },
      chatHistory: [],
    } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/chat/stream")) {
          return Promise.resolve(
            sse([
              ["delta", { text: streamDelta }],
              ["proposal", { path: "blueprint.md", text: NEW, valid: true, error: "" }],
              [
                "done",
                {
                  message: {
                    id: 7,
                    novel_id: 1,
                    role: "assistant",
                    content: streamDelta,
                    mode: "write",
                    model: "MiniMax-M2.5",
                    mentions: [],
                    context_refs: [],
                    steps: [],
                    token_input: 10,
                    token_output: 5,
                    created_at: "",
                  },
                },
              ],
              ["end", {}],
            ]),
          );
        }
        if (url.includes("/chat/messages")) return Promise.resolve(json(historyRows));
        if (url.includes("/files/blueprint.md") && init?.method === "PUT") {
          writes.push(JSON.parse(String(init.body)));
          return Promise.resolve(json({ path: "blueprint.md", changed: ["constraints"], revision: "rev-2" }));
        }
        if (url.includes("/files/blueprint.md")) return Promise.resolve(json(doc));
        if (url.includes("/files/toc.md")) {
          return Promise.resolve(
            json({ path: "toc.md", kind: "toc", layer: "B", label: "目录", text: tocOnServer, ai_fields: [], revision: "rev-toc" }),
          );
        }
        return Promise.resolve(json([]));
      }),
    );
  });

  it("turns a streamed markdown block into a diff card, and applies it as actor=ai", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "把第二条收紧一点");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(document.querySelector(".proposal")).toBeTruthy();
    });
    const card = document.querySelector(".proposal") as HTMLElement;
    expect(card.querySelector(".proposal-file")?.textContent).toBe("blueprint.md");
    expect(card.querySelector(".proposal-line.minus")?.textContent).toContain("皇朝命轨");
    expect(card.querySelector(".proposal-line.plus")?.textContent).toContain("凡人命轨");
    // 批注 3: that caption is deleted - the lock it described is a property of the
    // diff above, not a subtitle. 批注 4/5/6: the three actions are marks now, and
    // the words survive where they do no damage: the accessible name.
    expect(card.querySelector(".proposal-note")).toBeNull();
    for (const name of ["在编辑器中打开", "丢弃提案", "应用提案"]) {
      expect(card.querySelector(`button[aria-label="${name}"]`)).toBeTruthy();
    }

    // The offer also reaches the editor: the amber band and the disabled save.
    expect(useFiles.getState().pending["blueprint.md"]).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "应用提案" }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toMatchObject({ actor: "ai", base_revision: "rev-1", text: NEW });
    await waitFor(() => {
      expect(useFiles.getState().pending["blueprint.md"]).toBeUndefined();
    });
  });

  it("drops the card without writing when discarded", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "改一下");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "丢弃提案" }));
    await waitFor(() => {
      expect(document.querySelector(".proposal")).toBeNull();
    });
    expect(writes).toHaveLength(0);
  });

  it("puts the review card back after a reload", async () => {
    historyRows = [
      {
        id: 3,
        novel_id: 1,
        role: "assistant",
        content: "我改好了",
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "blueprint.md", text: NEW, valid: true, error: "" }],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await screen.findByText("我改好了");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());
    const card = document.querySelector(".proposal") as HTMLElement;
    expect(card.querySelector(".proposal-file")?.textContent).toBe("blueprint.md");
    expect(card.querySelector(".proposal-line.minus")?.textContent).toContain("皇朝命轨");
    expect(useFiles.getState().pending["blueprint.md"]).toBeTruthy();
  });

  it("leaves a proposal the owner already applied in the past", async () => {
    historyRows = [
      {
        id: 3,
        novel_id: 1,
        role: "assistant",
        content: "较早的待处理提案",
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "blueprint.md", text: NEW, valid: true, error: "" }],
      },
      {
        id: 4,
        novel_id: 1,
        role: "assistant",
        content: "已按你的确认写入",
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "blueprint.md", text: OLD, valid: true, error: "" }],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await screen.findByText("已按你的确认写入");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(document.querySelector(".proposal")).toBeNull();
    expect(useFiles.getState().pending["blueprint.md"]).toBeUndefined();
  });

  /* 批注 35.31（2026-09-11 真机量到）：这一条已经应用过了——服务器上的 toc.md 逐字等于那份
     提案，于是 offerFromStream 走丢弃分支：不挂卡，也不给这一行留下任何「它提议过什么」。
     而摘掉那份 JSON 的条件读的正是「这一行有没有 toc.md 那一份」，所以永远不成立，
     那几行 JSON 就一直摊在气泡里成第二个代码框。判据：pre 数 0、文本里 "chapters" 命中 0，
     而且不许顺手把人说的话一起摘掉。 */
  it("批注 35.31：已经应用过的那份整 JSON 不再摊在气泡里", async () => {
    historyRows = [
      {
        id: 6,
        novel_id: 1,
        role: "assistant",
        content: TOC_JSON,
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "toc.md", text: TOC_APPLIED, valid: true, error: "" }],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await screen.findByText("要不要我继续扩展？");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    // 不挂卡：这一半是 35.20 的既有决定，本条不许推翻
    expect(document.querySelector(".proposal")).toBeNull();
    expect(useFiles.getState().pending["toc.md"]).toBeUndefined();
    expect(document.querySelectorAll("pre")).toHaveLength(0);
    const bubble = document.querySelector(".chat-card.agent");
    expect(bubble?.textContent).not.toContain('"chapters"');
    expect(bubble?.textContent).toContain("我先给出目录：");
    expect(bubble?.textContent).toContain("要不要我继续扩展？");
  });

  /* 35.31 验收的第二句：未应用的那一条仍然「有卡 ＋ 无代码框」。这一条钉的是本条没把
     D-51 的既有语义改掉——服务器上的文件和提案不相等时，卡照挂，那份 JSON 照摘。 */
  it("批注 35.31：还没应用的那一份照旧挂卡，气泡里仍不摊第二个代码框", async () => {
    tocOnServer = "# B 目录\n\n（空）\n";
    historyRows = [
      {
        id: 7,
        novel_id: 1,
        role: "assistant",
        content: TOC_JSON,
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "toc.md", text: TOC_APPLIED, valid: true, error: "" }],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await screen.findByText("要不要我继续扩展？");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());
    expect(document.querySelector(".proposal-file")?.textContent).toBe("toc.md");
    expect(document.querySelectorAll("pre")).toHaveLength(0);
    expect(document.querySelector(".chat-card.agent")?.textContent).not.toContain('"chapters"');
  });

  it("ignores a stored fence that names a retired .yaml path", async () => {
    historyRows = [
      {
        id: 5,
        novel_id: 1,
        role: "assistant",
        content: "上一轮的旧格式提案",
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "blueprint.yaml", text: NEW, valid: true, error: "" }],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);
  
    await screen.findByText("上一轮的旧格式提案");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(document.querySelector(".proposal")).toBeNull();
  });
  
  /* 批注 35.20/35.21 (2026-09-10): the box the owner called 弹窗 was this path. A
     proposal the structure gate refused cannot be applied - the mark is disabled and
     applyProposal refuses it - so putting it back after a reload only reprinted a
     67-row diff of words that would never be written. */
  it("leaves a proposal the server refused off the thread after a reload", async () => {
    historyRows = [
      {
        id: 5,
        novel_id: 1,
        role: "assistant",
        content: "我建了一张人物卡",
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [
          { path: "settings/characters/new.md", text: NEW, valid: false, error: "缺少 姓名、分级" },
        ],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await screen.findByText("我建了一张人物卡");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(document.querySelector(".proposal")).toBeNull();
    expect(useFiles.getState().pending["settings/characters/new.md"]).toBeUndefined();
  });

  /* 批注 35.22: 关掉的标签，进设置页再退出来又自己打开. The card is read on its own
     message, so restoring it needs no tab - and re-adding one overwrites the owner's
     own click. */
  it("brings a still-open question back without reopening its tab", async () => {
    historyRows = [
      {
        id: 3,
        novel_id: 1,
        role: "assistant",
        content: "目录还没落库",
        mode: "plan",
        model: "MiniMax-M2.5",
        mentions: [],
        context_refs: [],
        steps: [],
        token_input: 1,
        token_output: 1,
        created_at: "",
        proposals: [{ path: "blueprint.md", text: NEW, valid: true, error: "" }],
      },
    ];
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await screen.findByText("目录还没落库");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());
    expect(useFiles.getState().tabs).not.toContain("blueprint.md");

    // The explicit gesture is what opens the file, and it still does.
    await userEvent.click(screen.getByRole("button", { name: "在编辑器中打开" }));
    expect(useFiles.getState().tabs).toContain("blueprint.md");
  });

  /* 批次 35.21（2026-09-10 真机，作品 4）：正文里那个 ```markdown @toc.md 围栏把整份
     被提议的文件又摊了一遍，卡片在下面逐行列一次——同一屏两个代码框；点完应用，卡片走了、
     围栏留下，线程上只剩一个代码框。被提议的文件只在卡片上出现一次。 */
  it("shows the offered file on the card only, never as a second code box", async () => {
    streamDelta =
      "我改好了\n\n```markdown @blueprint.md\n# A 层\nconstraints: 不可挪动凡人命轨\n```\n";
    const user = userEvent.setup();
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "把第二条收紧一点");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());

    const card = document.querySelector(".chat-card.agent") as HTMLElement;
    expect(card.textContent).toContain("我改好了");
    expect(card.querySelector(".chat-code")).toBeNull();
    // The offered words are still there - once, on the card.
    const diff = document.querySelector(".proposal-diff") as HTMLElement;
    expect(diff.textContent).toContain("凡人命轨");
  });

  it("opens the file in the editor instead of writing", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChatPane /></MemoryRouter>);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "改一下");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "在编辑器中打开" }));
    expect(useFiles.getState().active).toBe("blueprint.md");
    expect(useFiles.getState().tabs).toContain("blueprint.md");
    expect(writes).toHaveLength(0);
  });
});
