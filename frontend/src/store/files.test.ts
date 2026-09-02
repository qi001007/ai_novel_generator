import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { BLUEPRINT_PATH, isDirty, useFiles } from "./files";

vi.mock("../api", () => ({
  api: { listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
}));

const mocked = vi.mocked(api);

const DOC = {
  path: BLUEPRINT_PATH,
  kind: "blueprint",
  layer: "A",
  label: "全本蓝图",
  text: "main_line: 旧\n",
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
    useFiles.getState().setDraft(BLUEPRINT_PATH, "main_line: 新\n");
    expect(isDirty(useFiles.getState().entries[BLUEPRINT_PATH])).toBe(true);

    await expect(useFiles.getState().save(BLUEPRINT_PATH)).resolves.toBe(true);
    expect(mocked.writeFile).toHaveBeenCalledWith(
      1,
      BLUEPRINT_PATH,
      "main_line: 新\n",
      { actor: "human", baseRevision: "rev-1" },
    );
  });

  it("flags a lost-update rejection as a conflict", async () => {
    mocked.writeFile.mockRejectedValueOnce(new Error("文件已被别处改动，请重新读取"));
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().setDraft(BLUEPRINT_PATH, "main_line: 新\n");
    await expect(useFiles.getState().save(BLUEPRINT_PATH)).resolves.toBe(false);
    expect(useFiles.getState().entries[BLUEPRINT_PATH].conflict).toBe(true);
  });

  it("refuses a human save while a proposal is on the table", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().offer({
      id: 1,
      path: BLUEPRINT_PATH,
      text: "main_line: AI\n",
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
      text: "main_line: AI\n",
      valid: true,
      error: "",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });
    await expect(useFiles.getState().applyProposal(BLUEPRINT_PATH)).resolves.toBe(true);
    expect(mocked.writeFile).toHaveBeenCalledWith(1, BLUEPRINT_PATH, "main_line: AI\n", {
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
      text: "main_line: AI\n",
      valid: true,
      error: "",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });
    useFiles.getState().discardProposal(BLUEPRINT_PATH);
    expect(useFiles.getState().pending).toEqual({});
    expect(mocked.writeFile).not.toHaveBeenCalled();
  });
});