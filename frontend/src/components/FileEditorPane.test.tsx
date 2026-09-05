import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditorView } from "@codemirror/view";

import FileEditorPane from "./FileEditorPane";
import { useFiles, type FileEntry } from "../store/files";
import { useWorkbench } from "../store/workbench";
import type { FileDoc } from "../types";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(async () => []), listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
}));

import { api } from "../api";

const BLUEPRINT: FileDoc = {
  path: "blueprint.md",
  kind: "blueprint",
  layer: "A",
  label: "全本蓝图",
  text: "# 全书蓝图（A 层 · 长期）\n\n> 小节标题是结构标识。\n\n## 主线\n\n## 终局\n",
  ai_fields: ["main_line", "ending"],
  revision: "fc7a685c0455",
};

const entry = (over: Partial<FileEntry> = {}): FileEntry => ({
  doc: BLUEPRINT,
  draft: BLUEPRINT.text,
  loading: false,
  saving: false,
  error: null,
  conflict: false,
  savedAt: null,
  ...over,
});

function seed(over: Partial<FileEntry> = {}) {
  useFiles.setState({
    novelId: 1,
    metas: [{ path: "blueprint.md", kind: "blueprint", layer: "A", label: "全本蓝图" }],
    tabs: ["blueprint.md", "toc.md"],
    active: "blueprint.md",
    entries: { "blueprint.md": entry(over) },
    pending: {},
    // Not clearing these would leak one test's toggle into the next: the view map
    // is the only state the button reads, so it has to start from nothing.
    views: {},
    stage: null,
    jump: null,
    focus: null,
    revealSeq: 1,
    metasError: null,
  });
}

describe("FileEditorPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbench.setState({ novels: [{ id: 1, title: "九霄观星录" } as never], selectedNovelId: 1 });
    vi.mocked(api.writeFile).mockResolvedValue({ path: "blueprint.md", changed: [], revision: "rev-2" });
    vi.mocked(api.readFile).mockResolvedValue({ ...BLUEPRINT, revision: "rev-2" });
  });

  it("shows the tab strip and file bar, with no footer at all", async () => {
    seed();
    render(<FileEditorPane />);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(document.querySelector(".file-tab.active")?.textContent).toContain("blueprint.md");
    // 批注 11, 2026-09-04: the path is a chain of chevrons, not slashes inside a
    // sentence. The svg count is the separator, so assert it rather than the join.
    const crumb = document.querySelector(".file-path");
    expect(crumb?.textContent).toContain("九霄观星录");
    expect(crumb?.textContent).toContain("blueprint.md");
    expect(crumb?.textContent).not.toContain(" / ");
    expect(crumb?.querySelectorAll("svg")).toHaveLength(2);
    // Owner 2026-09-02: internal shorthand must not reach the reader.
    expect(document.querySelectorAll(".file-chip")).toHaveLength(0);
    // 批注 2026-09-04: the bottom bar is retired, so nothing may come back - and
    // with nothing pending and no error, the toolbar says nothing either.
    expect(document.querySelector(".file-foot")).toBeNull();
    expect(document.querySelector(".file-bar-note")).toBeNull();
    await waitFor(() => {
      expect(document.querySelector(".file-cm .cm-content")).toBeTruthy();
    });
  });

  it("keeps no permanent save control in the file bar", async () => {
    const user = userEvent.setup();
    seed();
    render(<FileEditorPane />);
    // 批注 12: Ctrl+S is bound, the tab carries a dirty ring and the foot names the
    // shortcut, so the button only repeated a third time what was already said.
    expect(document.querySelector(".file-save")).toBeNull();

    await user.click(screen.getByRole("button", { name: "toc.md" }));
    expect(useFiles.getState().active).toBe("toc.md");
  });

  it("saves the draft as actor=human with the revision it read", async () => {
    seed({ draft: "# 全书蓝图（A 层 · 长期）\n\n> 小节标题是结构标识。\n\n## 主线\n新\n\n## 终局\n" });
    render(<FileEditorPane />);

    // The shortcut is now the only path, so the test drives the shortcut.
    const content = document.querySelector(".file-cm .cm-content") as HTMLElement;
    content.focus();
    fireEvent.keyDown(content, { key: "s", ctrlKey: true, code: "KeyS" });
    await waitFor(() => {
      expect(api.writeFile).toHaveBeenCalledWith(1, "blueprint.md", expect.stringContaining("## 主线\n新"), {
        actor: "human",
        baseRevision: "fc7a685c0455",
      });
    });
  });

  it("locks saving while a proposal is pending, without printing it", async () => {
    seed();
    useFiles.setState({
      pending: {
        "blueprint.md": {
          id: 1,
          path: "blueprint.md",
          text: BLUEPRINT.text.replace("## 主线\n", "## 主线\nAI 改的\n"),
          valid: true,
          error: "",
          baseText: BLUEPRINT.text,
          baseRevision: BLUEPRINT.revision,
        },
      },
    });
    render(<FileEditorPane />);

    // 批注 2 (第十二批): the lock is real, the sentence is not. The tab already shows
    // a pending dot, so the words were a fourth copy of one fact.
    expect(document.querySelector(".file-bar-note")).toBeNull();
    expect(document.body.textContent).not.toContain("保存已锁定");
    expect(document.querySelector(".file-foot")).toBeNull();
    expect(document.querySelector(".pending-dot")).toBeTruthy();
    // Ctrl+S must not write over a pending proposal.
    const content = document.querySelector(".file-cm .cm-content") as HTMLElement;
    content.focus();
    fireEvent.keyDown(content, { key: "s", ctrlKey: true, code: "KeyS" });
    await Promise.resolve();
    await Promise.resolve();
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("names the source in reader-facing words when the reader arrived through a B→D jump", () => {
    seed();
    useFiles.setState({
      active: "briefs/0043.md",
      jump: { fromPath: "toc.md", chapter: 43, field: "plot_function" },
    });
    render(<FileEditorPane />);

    expect(document.querySelector(".jump-bar")?.textContent).toContain("来自 toc.md · 第 43 章 · 剧情功能");
    expect(document.querySelector(".jump-bar")?.textContent).not.toContain("plot_function");
    expect(document.querySelector(".jump-bar")?.textContent).toContain("返回来源");
  });

  it("turns a click on a toc description into a jump to that chapter brief", async () => {
    const user = userEvent.setup();
    const toc: FileDoc = {
      path: "toc.md",
      kind: "toc",
      layer: "B",
      label: "目录",
      text: "# 目录（B 层 · 中期）\n\n> 一条一章。\n\n## 第 43 章 星渊碑影\n- **剧情功能**：沈砚初探碑文\n- **备注**：埋石门\n",
      ai_fields: ["title", "plot_function", "notes"],
      revision: "9b5597e18057",
    };
    useFiles.setState({
      novelId: 1,
      tabs: ["toc.md"],
      active: "toc.md",
      entries: {
        "toc.md": { doc: toc, draft: toc.text, loading: false, saving: false, error: null, conflict: false, savedAt: null },
      },
    });
    render(<FileEditorPane />);

    const cell = await waitFor(() => {
      const node = document.querySelector("[data-jump]") as HTMLElement;
      expect(node).toBeTruthy();
      return node;
    });
    expect(cell.dataset.jump).toBe("43:plot_function:goal");

    await user.click(cell);
    await waitFor(() => {
      expect(useFiles.getState().active).toBe("chapters/0043/brief.md");
    });
    expect(useFiles.getState().jump).toEqual({ fromPath: "toc.md", chapter: 43, field: "plot_function" });
    expect(useFiles.getState().focus).toMatchObject({
      path: "chapters/0043/brief.md",
      field: "goal",
    });
  });

  it("offers a reload when the server rejected the save as a conflict", async () => {
    const user = userEvent.setup();
    seed({ conflict: true, error: "文件已被别处改动" });
    render(<FileEditorPane />);

    expect(document.querySelector(".file-conflict")?.textContent).toContain("文件已被别处改动");
    await user.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(api.readFile).toHaveBeenCalled());
  });

  it("puts a lock segment on every structure line", async () => {
    const toc: FileDoc = {
      path: "toc.md",
      kind: "toc",
      layer: "B",
      label: "目录",
      text:
        "# 目录（B 层 · 中期）\n\n> 一条一章。\n\n## 第 42 章 星渊碑影\n- **剧情功能**：初探\n- **备注**：埋石门\n\n## 第 43 章 重读\n- **剧情功能**：违背阁律\n- **备注**：\n",
      ai_fields: ["title", "plot_function", "notes"],
      revision: "9b5597e18057",
    };
    useFiles.setState({
      novelId: 1,
      tabs: ["toc.md"],
      active: "toc.md",
      entries: {
        "toc.md": { doc: toc, draft: toc.text, loading: false, saving: false, error: null, conflict: false, savedAt: null },
      },
    });
    render(<FileEditorPane />);

    // one segment per `## 第 N 章` anchor; the value bullets stay unmarked
    await waitFor(() => expect(document.querySelectorAll(".cm-rail-seg.lock")).toHaveLength(2));
  });

  it("locks a settings book the same way it locks a planning record", async () => {
    const book: FileDoc = {
      path: "settings/foreshadow.md",
      kind: "foreshadow",
      layer: "设定",
      label: "伏笔",
      text:
        "# 伏笔（设定库 · 分册）\n\n> `伏笔 N` 是主键。\n\n## 伏笔 1 碑上缺名\n- **埋设章**：1\n- **内容**：磨痕是新的\n\n## 伏笔 2 守碑人的脚印\n- **埋设章**：2\n- **内容**：\n",
      ai_fields: ["title", "status", "content"],
      revision: "9b5597e18057",
    };
    useFiles.setState({
      novelId: 1,
      tabs: ["settings/foreshadow.md"],
      active: "settings/foreshadow.md",
      entries: {
        "settings/foreshadow.md": { doc: book, draft: book.text, loading: false, saving: false, error: null, conflict: false, savedAt: null },
      },
    });
    render(<FileEditorPane />);

    // the key line is structure, the value bullets are not
    await waitFor(() => expect(document.querySelectorAll(".cm-rail-seg.lock")).toHaveLength(2));
    // and the breadcrumb must not call a settings sheet planning
    expect(document.querySelector(".file-path")?.textContent).toContain("设定库");
  });

  it("parks the caret on a character section, where 目标 is the sheet's own column", async () => {
    const character: FileDoc = {
      path: "settings/characters/1.md",
      kind: "character",
      layer: "设定",
      label: "沈曜 档案",
      text:
        "# 沈曜（设定库 · 人物）\n\n> 文件名人物号即主键。\n\n- **姓名**：沈曜\n\n## 身份\n\n观星少年\n\n## 目标\n\n找回父亲消失的真相\n\n## 行为约束\n\n不赌命\n\n## 当前状态\n\n碑前\n",
      ai_fields: [],
      revision: "9b5597e18057",
    };
    const entryOf = (over: Partial<FileEntry>) => ({
      doc: character,
      draft: character.text,
      loading: false,
      saving: false,
      error: null,
      conflict: false,
      savedAt: null,
      ...over,
    });
    useFiles.setState({
      novelId: 1,
      tabs: ["settings/characters/1.md"],
      active: "settings/characters/1.md",
      entries: { "settings/characters/1.md": entryOf({}) },
      focus: { path: "settings/characters/1.md", field: "goals", seq: 1 },
    });
    render(<FileEditorPane />);

    const caretLine = () => {
      const view = EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement);
      if (!view) return 0;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    };
    // 目标 is `goal` in a brief and `goals` in a character sheet: the pencil must
    // still land inside the sheet's own section, on its first body line.
    await waitFor(() => expect(caretLine()).toBe(13));
    expect(character.text.split("\n")[12]).toBe("找回父亲消失的真相");

    useFiles.setState({ focus: { path: "settings/characters/1.md", field: "current_status", seq: 2 } });
    await waitFor(() => expect(caretLine()).toBe(21));
    expect(character.text.split("\n")[20]).toBe("碑前");
  });
});

