import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { BLUEPRINT_PATH, chapterMatches, chapterNumberLabel, isDirty, useFiles } from "./files";

vi.mock("../api", () => ({
  api: { listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
}));

const mocked = vi.mocked(api);

const DOC = {
  path: BLUEPRINT_PATH,
  kind: "blueprint",
  layer: "A",
  label: "全本蓝图",
  text: "## 主线\n旧\n",
  ai_fields: ["main_line"],
  revision: "rev-1",
};

describe("files store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFiles.getState().reset();
    mocked.listFiles.mockResolvedValue([{ path: BLUEPRINT_PATH, kind: "blueprint", layer: "A", label: "全本蓝图" }]);
    mocked.readFile.mockResolvedValue(DOC);
    mocked.writeFile.mockResolvedValue({ path: BLUEPRINT_PATH, changed: ["main_line"], revision: "rev-2" });
  });

  it("opens a file and reveals the editor column", async () => {
    await useFiles.getState().attach(1);
    const before = useFiles.getState().revealSeq;
    await useFiles.getState().open(BLUEPRINT_PATH);
    const state = useFiles.getState();
    expect(state.active).toBe(BLUEPRINT_PATH);
    expect(state.entries[BLUEPRINT_PATH].draft).toBe(DOC.text);
    expect(state.revealSeq).toBe(before + 1);
    expect(isDirty(state.entries[BLUEPRINT_PATH])).toBe(false);
  });

  it("saves with the revision it read, then re-reads", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().setDraft(BLUEPRINT_PATH, "## 主线\n新\n");
    expect(isDirty(useFiles.getState().entries[BLUEPRINT_PATH])).toBe(true);

    await expect(useFiles.getState().save(BLUEPRINT_PATH)).resolves.toBe(true);
    expect(mocked.writeFile).toHaveBeenCalledWith(
      1,
      BLUEPRINT_PATH,
      "## 主线\n新\n",
      { actor: "human", baseRevision: "rev-1" },
    );
  });

  it("flags a lost-update rejection as a conflict", async () => {
    mocked.writeFile.mockRejectedValueOnce(new Error("文件已被别处改动，请重新读取"));
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().setDraft(BLUEPRINT_PATH, "## 主线\n新\n");
    await expect(useFiles.getState().save(BLUEPRINT_PATH)).resolves.toBe(false);
    expect(useFiles.getState().entries[BLUEPRINT_PATH].conflict).toBe(true);
  });

  it("refuses a human save while a proposal is on the table", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().offer({
      id: 1,
      path: BLUEPRINT_PATH,
      text: "## 主线\nAI\n",
      valid: true,
      error: "",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });
    useFiles.getState().setDraft(BLUEPRINT_PATH, "main_line: 人\n");
    await expect(useFiles.getState().save(BLUEPRINT_PATH)).resolves.toBe(false);
    expect(mocked.writeFile).not.toHaveBeenCalled();
  });

  it("writes an accepted proposal as actor=ai and drops it from pending", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().offer({
      id: 2,
      path: BLUEPRINT_PATH,
      text: "## 主线\nAI\n",
      valid: true,
      error: "",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });
    await expect(useFiles.getState().applyProposal(BLUEPRINT_PATH)).resolves.toBe(true);
    expect(mocked.writeFile).toHaveBeenCalledWith(1, BLUEPRINT_PATH, "## 主线\nAI\n", {
      actor: "ai",
      baseRevision: "rev-1",
    });
    expect(useFiles.getState().pending[BLUEPRINT_PATH]).toBeUndefined();
  });

  it("discards a proposal without touching the server", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().offer({
      id: 3,
      path: BLUEPRINT_PATH,
      text: "## 主线\nAI\n",
      valid: true,
      error: "",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });
    useFiles.getState().discardProposal(BLUEPRINT_PATH);
    expect(useFiles.getState().pending).toEqual({});
    expect(mocked.writeFile).not.toHaveBeenCalled();
  });

  it("does not invent a tree entry for a brief the server never wrote", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open("briefs/0048.md");
    const state = useFiles.getState();
    expect(state.active).toBe("briefs/0048.md");
    // read_file renders an empty brief on the fly; that must not look like a file.
    expect(state.metas.map((meta) => meta.path)).toEqual([BLUEPRINT_PATH]);
  });

  it("re-reads the file list after a write so a new brief becomes real", async () => {
    const brief = { path: "briefs/0048.md", kind: "brief", layer: "D", label: "第 48 章简报" };
    mocked.listFiles
      .mockResolvedValueOnce([{ path: BLUEPRINT_PATH, kind: "blueprint", layer: "A", label: "全本蓝图" }])
      .mockResolvedValueOnce([
        { path: BLUEPRINT_PATH, kind: "blueprint", layer: "A", label: "全本蓝图" },
        brief,
      ]);
    await useFiles.getState().attach(1);
    await useFiles.getState().open("briefs/0048.md");
    useFiles.getState().setDraft("briefs/0048.md", "- **章节号**：48\n");
    await expect(useFiles.getState().save("briefs/0048.md")).resolves.toBe(true);
    expect(useFiles.getState().metas.map((meta) => meta.path)).toContain("briefs/0048.md");
  });
});

/* 第十六批批注 4：树里显示 0001，搜索却拿 String(1) 去比，于是主人输「0」搜不到。
   判据是「屏幕上看得见的东西必须搜得到」，所以钉的是显示值，不是字段值。 */
describe("the tree's chapter search", () => {
  it("finds chapter 1 by everything the row shows", () => {
    for (const needle of ["0", "00", "000", "0001", "1"]) {
      expect(chapterMatches({ chapter_number: 1, title: "星潮夜" }, needle), needle).toBe(true);
    }
  });

  it("still matches on the title, case-insensitively", () => {
    expect(chapterMatches({ chapter_number: 7, title: "Star Tide" }, "star")).toBe(true);
    expect(chapterMatches({ chapter_number: 7, title: null }, "star")).toBe(false);
  });

  it("does not match a number that is not in the label", () => {
    expect(chapterMatches({ chapter_number: 1, title: "" }, "2")).toBe(false);
    expect(chapterMatches({ chapter_number: 12, title: "" }, "012")).toBe(true);
  });

  it("pads to four digits but never truncates a long number", () => {
    expect(chapterNumberLabel(1)).toBe("0001");
    expect(chapterNumberLabel(12345)).toBe("12345");
  });
});
