import type {
  BackupDocument,
  BackupSnapshot,
  ChatContextItem,
  ChatStreamEvent,
  FileDoc,
  FileMeta,
  FileWriteResult,
  Novel,
  NovelUpdatePayload,
  StreamChatPayload,
  GenerationStreamEvent,
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

  // 204 没有 body。删除端点返回它是标准做法；让 request 去 json() 只会抛一个
  // 「Unexpected end of JSON input」，把一次成功的删除显示成失败。
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

function parseSseBlock<T = unknown>(block: string): T | null {
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
    return { event, data: data ? JSON.parse(data) : {} } as T;
  } catch {
    return null;
  }
}

/** 后端给的中文文件名走 RFC 5987；老客户端只看 filename="..." 那一段。 */
function fileNameFromDisposition(header: string | null): string {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "");
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = /filename="([^"]+)"/i.exec(header ?? "");
  return plain?.[1] ?? "export.txt";
}

/** 落一个文本文件到浏览器下载。用 blob 而不是直接把 <a href> 指过去，
 *  是为了让 404/409 能显示成人话 - 否则浏览器会把错误体当成文件存下来，
 *  主人就得到一个 0 字节的「导出成功」。 */
function saveTextFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
        const event = parseSseBlock<ChatStreamEvent>(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) onEvent(event);
        boundary = buffer.indexOf("\n\n");
      }
    }

    const trailing = parseSseBlock<ChatStreamEvent>(buffer);
    if (trailing) onEvent(trailing);
  },

  streamGeneration: async (
    novelId: number,
    briefId: number,
    onEvent: (event: GenerationStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const response = await fetch(
      `/api/novels/${novelId}/chapters/from-brief/${briefId}/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
      },
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail ?? `生成请求失败（${response.status}）`);
    }
    if (!response.body) throw new Error("当前浏览器不支持流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = parseSseBlock<GenerationStreamEvent>(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) onEvent(event);
        boundary = buffer.indexOf("\n\n");
      }
    }
    const trailing = parseSseBlock<GenerationStreamEvent>(buffer);
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

  /** 导出是**读**：拿回文本，在浏览器里造一个下载。写通路仍然只有那一条（D-01）。
   *  用 blob 而不是直接把 <a href> 指过去，是为了让 404/409 能显示成人话。 */
  exportProse: async (
    novelId: number,
    params: { scope: "book" | "chapter"; chapterNumber?: number; format: "txt" | "md" },
  ): Promise<string> => {
    const query = new URLSearchParams({ scope: params.scope, format: params.format });
    if (params.chapterNumber !== undefined) {
      query.set("chapter_number", String(params.chapterNumber));
    }
    const response = await fetch(`/api/novels/${novelId}/export?${query.toString()}`);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail ?? `导出失败（${response.status}）`);
    }
    const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"));
    saveTextFile(await response.text(), fileName);
    return fileName;
  },

  /** 第二十五批批注 4：导出不止正文 - 蓝图、目录、剧情弧、每章简报、设定库的每一份文档
   *  都要能拿走。导的就是**屏上源码面那份文本**（投影 GET，不新增端点、不写库）。
   *  文件名用这份文档自己的 label（「第 1 章简报」这种），比 chapters_0001_brief.md 可读。 */
  exportDocument: async (novelId: number, path: string): Promise<string> => {
    const doc = await api.get<{ label?: string; text: string }>(`/api/novels/${novelId}/files/${path}`);
    const text = doc.text ?? "";
    if (!text.trim()) throw new Error("这份文档还没有内容，导出来是空的");
    const base = (doc.label && doc.label.trim()) || path.split("/").pop() || "document";
    const fileName = `${base.replace(/[\\/:*?"<>|]/g, "_")}.md`;
    saveTextFile(text, fileName);
    return fileName;
  },

  /** 导出目录（这台机器要把文件放到哪儿）。空 = 走浏览器下载。 */
  exportSettings: () => api.get<{ export_dir: string }>("/api/export/settings"),
  setExportDir: (dir: string) =>
    api.put<{ export_dir: string }>("/api/export/settings", { dir }),

  /** 一条导出、两条落点（第二十五批批注 3）：设置里有导出目录就交给后端写盘并回报路径；
   *  没有就退回浏览器下载。**真错误照样抛出去** - 只有「还没有设置导出目录」这一条
   *  才允许静默降级，否则用户会以为导出成功了其实只是弹了个下载。 */
  runExport: async (
    novelId: number,
    saveBody: Record<string, unknown>,
    download: () => Promise<string>,
  ): Promise<string> => {
    try {
      const saved = await api.post<{ saved_to: string }>(
        `/api/novels/${novelId}/export/save`,
        saveBody,
      );
      return `已保存到 ${saved.saved_to}`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (!message.includes("还没有设置导出目录")) throw cause;
      const name = await download();
      return `浏览器已下载 ${name}`;
    }
  },

  /** 撤销入口（第二十五批批注 5）：删除前留下的快照清单 + 三种恢复动作。 */
  listBackups: () =>
    api.get<{ export_dir: string; snapshots: BackupSnapshot[] }>("/api/backups"),
  backupDocuments: (file: string) =>
    api.get<BackupDocument[]>(`/api/backups/documents?file=${encodeURIComponent(file)}`),
  restoreNovel: (file: string) =>
    api.post<{ result: { novel_id: number; title: string; rows: number } }>(
      "/api/backups/restore/novel",
      { file },
    ),
  restoreDocument: (body: {
    file: string;
    novel_id: number;
    path: string;
    into: "book" | "dir";
  }) =>
    api.post<{ result: { restored: string; saved_to?: string; path?: string } }>(
      "/api/backups/restore/document",
      body,
    ),

  /** 删一章。章号不顺延（第二十六批批注 6 定下的语义）。 */
  deleteChapter: (novelId: number, chapterNumber: number) =>
    api.del<void>(`/api/novels/${novelId}/chapters/by-number/${chapterNumber}`),

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
