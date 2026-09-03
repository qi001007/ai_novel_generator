import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { api } from "../api";
import { useWorkbench } from "./workbench";
import type { Chapter, FileDoc } from "../types";

const chapter: Chapter = {
  id: 8,
  novel_id: 1,
  brief_id: 2,
  chapter_number: 42,
  title: "星渊碑影",
  content: "旧正文。",
  word_count: 4,
  status: "draft",
  final_decision: "",
  final_comment: "",
};

const draftDoc: FileDoc = {
  path: "chapters/0042/draft.md",
  kind: "draft",
  layer: "正文",
  label: "第 42 章正文",
  text: "# 第 42 章正文\n\n旧正文。\n",
  ai_fields: ["content"],
  revision: "draft-1",
};

describe("workbench chapter writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbench.setState({
      selectedNovelId: 1,
      selectedChapterId: 8,
      chapters: [chapter],
      draftContent: "沈曜推开了石门。",
      busy: false,
      error: null,
    });
    vi.mocked(api.readFile).mockResolvedValue(draftDoc);
    vi.mocked(api.writeFile).mockResolvedValue({
      path: draftDoc.path,
      changed: ["content"],
      revision: "draft-2",
    });
    vi.mocked(api.get).mockResolvedValue({
      ...chapter,
      content: "沈曜推开了石门。",
      word_count: 8,
    });
  });

  it("saves prose through the chapter draft file, not the legacy chapter route", async () => {
    await useWorkbench.getState().saveChapter();

    expect(api.put).not.toHaveBeenCalled();
    expect(api.readFile).toHaveBeenCalledWith(1, "chapters/0042/draft.md");
    expect(api.writeFile).toHaveBeenCalledWith(
      1,
      "chapters/0042/draft.md",
      expect.stringContaining("# 第 42 章正文"),
      { baseRevision: "draft-1" },
    );
    expect(api.writeFile).toHaveBeenCalledWith(
      1,
      "chapters/0042/draft.md",
      expect.stringContaining("沈曜推开了石门。"),
      { baseRevision: "draft-1" },
    );
    expect(useWorkbench.getState().chapters[0].content).toContain("石门");
    expect(useWorkbench.getState().error).toBeNull();
  });
});
