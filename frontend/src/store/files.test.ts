import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import {
  BLUEPRINT_PATH,
  TOC_PATH,
  briefChapter,
  chapterMatches,
  chapterNumberLabel,
  isDirty,
  useFiles,
} from "./files";

vi.mock("../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api")>();
  return {
    // errorCode 用**真的那个**：判冲突现在靠机器码，把它 mock 掉就等于没测到这条分支
    ...real,
    api: { listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
  };
});

const mocked = vi.mocked(api);

const DOC = {
  path: BLUEPRINT_PATH,
  kind: "blueprint",
  layer: "A",
  label: "全书蓝图",
  text: "## 主线\n旧\n",
  ai_fields: ["main_line"],
  revision: "rev-1",
};

describe("files store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFiles.getState().reset();
    mocked.listFiles.mockResolvedValue([{ path: BLUEPRINT_PATH, kind: "blueprint", layer: "A", label: "全书蓝图" }]);
    mocked.readFile.mockResolvedValue(DOC);
    // 服务器回报的是它真正写入的路径；建人物流水线的测试各自覆盖这一条。
    mocked.writeFile.mockImplementation(async (_novelId, path) => ({
      path,
      changed: ["main_line"],
      revision: "rev-2",
    }));
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
    mocked.writeFile.mockRejectedValueOnce(
      Object.assign(new Error("chapters/0001/draft.md 已被其它写入改过（a → b），请重载后再写"), {
        status: 409,
        code: "write_conflict",
      }),
    );
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

  /* 批注 35.22 (2026-09-10): the same rule one level down. A restored offer is the card
     coming back, not the tab strip being rearranged behind the owner's back. */
  it("restores an offer onto the message without touching the tab strip", async () => {
    await useFiles.getState().attach(1);
    const tabs = useFiles.getState().tabs;
    useFiles.getState().offer(
      {
        id: 9,
        path: TOC_PATH,
        text: "## 第 1 章 开门\n",
        valid: true,
        error: "",
        baseText: DOC.text,
        baseRevision: "rev-1",
      },
      { restore: true },
    );
    expect(useFiles.getState().pending[TOC_PATH]).toBeTruthy();
    expect(useFiles.getState().tabs).toEqual(tabs);
    // A B-layer offer normally comes forward; a restored one must not move the screen.
    expect(useFiles.getState().active).not.toBe(TOC_PATH);
  });

  /* 批注 35.17 (2026-09-11): 一张被校验拒掉的围栏不是「一个等着打开的文件」，而是「这一行
     AI 提议过什么、而那份提议不合格」。以前 offer() 给任何路径都补一格标签，于是作品 6 的
     msg 65（缺 `姓名/分级/起始章/结束章`、`valid=false`、路径 `settings/characters/new.md`）
     每次刷新都在标签条留一格空白的「新建人物」。卡片必须继续挂在原消息上（主人得看见被拒的
     是哪一份、也才丢得掉），被砍的只有那一格。 */
  it("keeps an invalid proposal off the tab strip (批注 35.17)", async () => {
    const NEW = "settings/characters/new.md";
    const proposal = {
      id: 65,
      path: NEW,
      text: "# 无名\n",
      error: "缺少「姓名/分级/起始章/结束章」",
      baseText: DOC.text,
      baseRevision: "rev-1",
    };
    await useFiles.getState().attach(1);
    const tabs = useFiles.getState().tabs;

    useFiles.getState().offer({ ...proposal, valid: false });
    const state = useFiles.getState();
    expect(state.tabs).toEqual(tabs);
    // 提案本身还在：卡片靠它渲染，「丢弃」也靠它从 pending 里摘掉。
    expect(state.pending[NEW]).toBeTruthy();

    // 另一半，不许被「一律不加标签」顺手打死：合法的那一份仍要落到标签条，
    // 否则 35.5 那条「建卡换格」的链就没有格子可换。
    useFiles.getState().offer({ ...proposal, valid: true });
    expect(useFiles.getState().tabs).toEqual([...tabs, NEW]);
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
    const applied = useFiles.getState().appliedSeq;
    await expect(useFiles.getState().applyProposal(BLUEPRINT_PATH)).resolves.toBe(true);
    expect(mocked.writeFile).toHaveBeenCalledWith(1, BLUEPRINT_PATH, "## 主线\nAI\n", {
      actor: "ai",
      baseRevision: "rev-1",
    });
    expect(useFiles.getState().pending[BLUEPRINT_PATH]).toBeUndefined();
    // 批注 4 (2026-09-09): the landing write is also what tells the chapter tree and
    // the character cards to re-read the database. Counted as a delta, because the
    // signal is monotonic on purpose - a novel switch must not look like new work.
    expect(useFiles.getState().appliedSeq).toBe(applied + 1);
  });

  it("keeps a rejected proposal out of the write path", async () => {
    await useFiles.getState().attach(1);
    await useFiles.getState().open(BLUEPRINT_PATH);
    useFiles.getState().offer({
      id: 5,
      path: BLUEPRINT_PATH,
      text: "## 主线\nAI\n",
      valid: false,
      error: "第 3 行缺少「章节号」",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });
    const applied = useFiles.getState().appliedSeq;

    // 批注 2: the card already disables the mark; this is the same rule at the only
    // write entry, so no caller can PUT text the server refused.
    await expect(useFiles.getState().applyProposal(BLUEPRINT_PATH)).resolves.toBe(false);
    expect(mocked.writeFile).not.toHaveBeenCalled();
    expect(useFiles.getState().entries[BLUEPRINT_PATH].error).toContain("未通过校验");
    expect(useFiles.getState().entries[BLUEPRINT_PATH].error).toContain("第 3 行缺少「章节号」");
    // The card stays on the table so the owner can discard it; nothing was applied.
    expect(useFiles.getState().pending[BLUEPRINT_PATH]).toBeTruthy();
    expect(useFiles.getState().appliedSeq).toBe(applied);
  });

  it("applies a B-layer proposal, then reloads the same Markdown projection", async () => {
    const tocDoc = { ...DOC, path: TOC_PATH, kind: "toc", layer: "B", label: "目录" };
    const updatedTocDoc = { ...tocDoc, text: "## 第 1 章 第一扇门\n", revision: "rev-2" };
    let tocReads = 0;
    mocked.readFile.mockImplementation(async (_novelId, path) => {
      if (path !== TOC_PATH) return DOC;
      tocReads += 1;
      return tocReads === 1 ? tocDoc : updatedTocDoc;
    });
    await useFiles.getState().attach(1);
    await useFiles.getState().open(TOC_PATH);
    useFiles.getState().offer({
      id: 4,
      path: TOC_PATH,
      text: "## 第 1 章 第一扇门\n- **剧情功能**：建立目标\n- **备注**：\n",
      valid: true,
      error: "",
      baseText: tocDoc.text,
      baseRevision: "rev-1",
    });

    await expect(useFiles.getState().applyProposal(TOC_PATH)).resolves.toBe(true);

    expect(mocked.writeFile).toHaveBeenCalledWith(1, TOC_PATH, expect.stringContaining("第一扇门"), {
      actor: "ai",
      baseRevision: "rev-1",
    });
    expect(useFiles.getState().entries[TOC_PATH].draft).toBe(updatedTocDoc.text);
    expect(useFiles.getState().pending[TOC_PATH]).toBeUndefined();
  });

  it("follows the numbered path a character create actually lands on (批注 35.5)", async () => {
    const NEW = "settings/characters/new.md";
    const LANDED = "settings/characters/7.md";
    const landedDoc = { ...DOC, path: LANDED, kind: "character", layer: "设定", label: "罗九" };
    mocked.readFile.mockImplementation(async (_novelId, path) =>
      path === LANDED ? landedDoc : { ...DOC, path: NEW, kind: "character", label: "新建人物" },
    );
    mocked.writeFile.mockResolvedValueOnce({ path: LANDED, changed: [], revision: "rev-2" });
    await useFiles.getState().attach(1);
    await useFiles.getState().open(NEW);
    useFiles.getState().offer({
      id: 6,
      path: NEW,
      text: "# 罗九\n- **定位**：主角\n",
      valid: true,
      error: "",
      baseText: DOC.text,
      baseRevision: "rev-1",
    });

    await expect(useFiles.getState().applyProposal(NEW)).resolves.toBe(true);

    const state = useFiles.getState();
    expect(mocked.readFile).toHaveBeenCalledWith(1, LANDED);
    expect(state.entries[NEW]).toBeUndefined();
    expect(state.entries[LANDED].draft).toBe(landedDoc.text);
    expect(state.pending[NEW]).toBeUndefined();
    expect(state.tabs).toEqual([LANDED]);
    expect(state.active).toBe(LANDED);
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
      .mockResolvedValueOnce([{ path: BLUEPRINT_PATH, kind: "blueprint", layer: "A", label: "全书蓝图" }])
      .mockResolvedValueOnce([
        { path: BLUEPRINT_PATH, kind: "blueprint", layer: "A", label: "全书蓝图" },
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

describe("the chapter a brief path names", () => {
  // 批注 35.33：`chapters/NNNN/brief.md` 才是规范路径（D-03），它命中的是第二个捕获组，
  // 而旧写法只读 m[1]，于是回 NaN。NaN 不是 null，调用方那句 `?? 0` 挡不住它，
  // 屏上就成了「第 NaN 章」。
  it("reads the number out of the canonical path, not just the legacy one", () => {
    expect(briefChapter("briefs/0007.md")).toBe(7);
    expect(briefChapter("chapters/0007/brief.md")).toBe(7);
  });

  it("says null for a path that names no brief, so callers never see NaN", () => {
    expect(briefChapter("chapters/0007/draft.md")).toBeNull();
    expect(briefChapter("chapters/0007/meta.md")).toBeNull();
    expect(briefChapter("toc.md")).toBeNull();
  });
});
