import type {
  ChatContextItem,
  ChatStreamEvent,
  FileDoc,
  FileMeta,
  FileWriteResult,
  Novel,
  NovelUpdatePayload,
  StreamChatPayload,
} from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? response.statusText);
  }

  return (await response.json()) as T;
}

function parseSseBlock(block: string): ChatStreamEvent | null {
  let event = "";
  let data = "";
  for (const line of block.split("\n")) {
    const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (raw.startsWith("event:")) {
      event = raw.slice(6).trim();
    } else if (raw.startsWith("data:")) {
      data += raw.slice(5).trim();
    }
  }
  if (!event) return null;
  try {
    return { event, data: data ? JSON.parse(data) : {} } as ChatStreamEvent;
  } catch {
    return null;
  }
}

export const api = {
  get: async <T,>(path: string): Promise<T> => request<T>(path),
  post: async <T,>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: async <T,>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: async <T,>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),

  // EventSource cannot POST, so the SSE body is decoded by hand here.
  streamChat: async (
    novelId: number,
    body: StreamChatPayload,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const response = await fetch(`/api/novels/${novelId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail ?? `对话请求失败（${response.status}）`);
    }
    if (!response.body) {
      throw new Error("当前浏览器不支持流式响应");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = parseSseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) onEvent(event);
        boundary = buffer.indexOf("\n\n");
      }
    }

    const trailing = parseSseBlock(buffer);
    if (trailing) onEvent(trailing);
  },

  listChatContext: (novelId: number, params: { q?: string; kind?: string }) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.kind) query.set("kind", params.kind);
    const suffix = query.toString();
    return api.get<ChatContextItem[]>(
      `/api/novels/${novelId}/chat/context${suffix ? `?${suffix}` : ""}`,
    );
  },

  updateNovel: (novelId: number, payload: NovelUpdatePayload) =>
    api.put<Novel>(`/api/novels/${novelId}`, payload),

  // --- document layer: the four planning files (DB stays the source of truth) ---
  listFiles: (novelId: number) => api.get<FileMeta[]>(`/api/novels/${novelId}/files`),

  readFile: (novelId: number, path: string) =>
    api.get<FileDoc>(`/api/novels/${novelId}/files/${path}`),

  // base_revision is what turns a lost update into a 409 instead of a silent overwrite.
  writeFile: (novelId: number, path: string, text: string, opts: { actor?: string; baseRevision?: string } = {}) =>
    api.put<FileWriteResult>(`/api/novels/${novelId}/files/${path}`, {
      text,
      actor: opts.actor ?? "human",
      base_revision: opts.baseRevision ?? undefined,
    }),
};
