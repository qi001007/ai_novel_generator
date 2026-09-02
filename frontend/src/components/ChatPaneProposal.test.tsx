import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPane from "./ChatPane";
import { useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";

const OLD = "# A 层\nconstraints: 不可挪动皇朝命轨\n";
const NEW = "# A 层\nconstraints: 不可挪动凡人命轨\n";

const doc = {
  path: "blueprint.yaml",
  kind: "blueprint",
  layer: "A",
  label: "全本蓝图",
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

describe("ChatPane proposals", () => {
  beforeEach(() => {
    writes.length = 0;
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
              ["delta", { text: "我改好了" }],
              ["proposal", { path: "blueprint.yaml", text: NEW, valid: true, error: "" }],
              [
                "done",
                {
                  message: {
                    id: 7,
                    novel_id: 1,
                    role: "assistant",
                    content: "我改好了",
                    mode: "write",
                    model: "MiniMax-M2.5",
                    mentions: [],
                    context_refs: [],
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
        if (url.includes("/chat/history")) return Promise.resolve(json([]));
        if (url.includes("/files/blueprint.yaml") && init?.method === "PUT") {
          writes.push(JSON.parse(String(init.body)));
          return Promise.resolve(json({ path: "blueprint.yaml", changed: ["constraints"], revision: "rev-2" }));
        }
        if (url.includes("/files/blueprint.yaml")) return Promise.resolve(json(doc));
        return Promise.resolve(json([]));
      }),
    );
  });

  it("turns a streamed yaml block into a diff card, and applies it as actor=ai", async () => {
    const user = userEvent.setup();
    render(<ChatPane />);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "把第二条收紧一点");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(document.querySelector(".proposal")).toBeTruthy();
    });
    const card = document.querySelector(".proposal") as HTMLElement;
    expect(card.querySelector(".proposal-file")?.textContent).toBe("blueprint.yaml");
    expect(card.querySelector(".proposal-line.minus")?.textContent).toContain("皇朝命轨");
    expect(card.querySelector(".proposal-line.plus")?.textContent).toContain("凡人命轨");
    expect(card.querySelector(".proposal-note")?.textContent).toContain("AI 只改值");

    // The offer also reaches the editor: the amber band and the disabled save.
    expect(useFiles.getState().pending["blueprint.yaml"]).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toMatchObject({ actor: "ai", base_revision: "rev-1", text: NEW });
    await waitFor(() => {
      expect(useFiles.getState().pending["blueprint.yaml"]).toBeUndefined();
    });
  });

  it("drops the card without writing when discarded", async () => {
    const user = userEvent.setup();
    render(<ChatPane />);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "改一下");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "丢弃" }));
    await waitFor(() => {
      expect(document.querySelector(".proposal")).toBeNull();
    });
    expect(writes).toHaveLength(0);
  });

  it("opens the file in the editor instead of writing", async () => {
    const user = userEvent.setup();
    render(<ChatPane />);

    await user.type(document.querySelector(".chat-input textarea") as HTMLElement, "改一下");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelector(".proposal")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "在编辑器中打开" }));
    expect(useFiles.getState().active).toBe("blueprint.yaml");
    expect(useFiles.getState().tabs).toContain("blueprint.yaml");
    expect(writes).toHaveLength(0);
  });
});