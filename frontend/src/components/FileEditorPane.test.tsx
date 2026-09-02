import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FileEditorPane from "./FileEditorPane";
import { useFiles, type FileEntry } from "../store/files";
import { useWorkbench } from "../store/workbench";
import type { FileDoc } from "../types";

vi.mock("../api", () => ({
  api: { listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
}));

import { api } from "../api";

const BLUEPRINT: FileDoc = {
  path: "blueprint.yaml",
  kind: "blueprint",
  layer: "A",
  label: "全本蓝图",
  text: "# A 层 · 全本蓝图（长期）\nmain_line: ''\nending: ''\n",
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
    metas: [{ path: "blueprint.yaml", kind: "blueprint", layer: "A", label: "全本蓝图" }],
    tabs: ["blueprint.yaml", "toc.yaml"],
    active: "blueprint.yaml",
    entries: { "blueprint.yaml": entry(over) },
    pending: {},
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
    vi.mocked(api.writeFile).mockResolvedValue({ path: "blueprint.yaml", changed: [], revision: "rev-2" });
    vi.mocked(api.readFile).mockResolvedValue({ ...BLUEPRINT, revision: "rev-2" });
  });

  it("shows the tab strip, file bar and a clean footer", async () => {
    seed();
    render(<FileEditorPane />);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(document.querySelector(".file-tab.active")?.textContent).toContain("blueprint.yaml");
    expect(document.querySelector(".file-path")?.textContent).toContain("九霄观星录 / 规划 / blueprint.yaml");
    expect(document.querySelector(".file-chip.lock")?.textContent).toBe("键名与主键锁定");
    expect(document.querySelector(".file-chip.mono")?.textContent).toBe("YAML");
    expect(document.querySelector(".file-foot")?.textContent).toContain("与服务器一致");
    await waitFor(() => {
      expect(document.querySelector(".file-cm .cm-content")).toBeTruthy();
    });
  });

  it("hides the save button until the buffer differs from the server", async () => {
    const user = userEvent.setup();
    seed();
    render(<FileEditorPane />);
    const save = document.querySelector(".file-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "toc.yaml" }));
    expect(useFiles.getState().active).toBe("toc.yaml");
  });

  it("saves the draft as actor=human with the revision it read", async () => {
    const user = userEvent.setup();
    seed({ draft: "# A 层 · 全本蓝图（长期）\nmain_line: 新\nending: ''\n" });
    render(<FileEditorPane />);

    await user.click(document.querySelector(".file-save") as HTMLElement);
    await waitFor(() => {
      expect(api.writeFile).toHaveBeenCalledWith(1, "blueprint.yaml", expect.stringContaining("main_line: 新"), {
        actor: "human",
        baseRevision: "fc7a685c0455",
      });
    });
  });

  it("locks saving and warns in the footer while a proposal is pending", () => {
    seed();
    useFiles.setState({
      pending: {
        "blueprint.yaml": {
          id: 1,
          path: "blueprint.yaml",
          text: BLUEPRINT.text.replace("''", "'x'"),
          valid: true,
          error: "",
          baseText: BLUEPRINT.text,
          baseRevision: BLUEPRINT.revision,
        },
      },
    });
    render(<FileEditorPane />);

    expect((document.querySelector(".file-save") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".file-foot")?.textContent).toContain("1 处提案待应用 · 尚未写入服务器");
    expect(document.querySelector(".pending-dot")).toBeTruthy();
  });

  it("names the source when the reader arrived through a B→D jump", () => {
    seed();
    useFiles.setState({
      active: "briefs/0043.yaml",
      jump: { fromPath: "toc.yaml", chapter: 43, field: "plot_function" },
    });
    render(<FileEditorPane />);

    expect(document.querySelector(".jump-bar")?.textContent).toContain("来自 toc.yaml · 第 43 章 · plot_function");
    expect(document.querySelector(".jump-bar")?.textContent).toContain("返回来源");
  });

  it("turns a click on a toc description into a jump to that chapter brief", async () => {
    const user = userEvent.setup();
    const toc: FileDoc = {
      path: "toc.yaml",
      kind: "toc",
      layer: "B",
      label: "目录",
      text: "# B 层 · 目录（中期）\n- chapter: 43\n  title: 星渊碑影\n  plot_function: 沈砚初探碑文\n  notes: 埋石门\n",
      ai_fields: ["title", "plot_function", "notes"],
      revision: "9b5597e18057",
    };
    useFiles.setState({
      novelId: 1,
      tabs: ["toc.yaml"],
      active: "toc.yaml",
      entries: {
        "toc.yaml": { doc: toc, draft: toc.text, loading: false, saving: false, error: null, conflict: false, savedAt: null },
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
      expect(useFiles.getState().active).toBe("briefs/0043.yaml");
    });
    expect(useFiles.getState().jump).toEqual({ fromPath: "toc.yaml", chapter: 43, field: "plot_function" });
    expect(useFiles.getState().focus).toMatchObject({ path: "briefs/0043.yaml", field: "goal" });
  });

  it("offers a reload when the server rejected the save as a conflict", async () => {
    const user = userEvent.setup();
    seed({ conflict: true, error: "文件已被别处改动" });
    render(<FileEditorPane />);

    expect(document.querySelector(".file-conflict")?.textContent).toContain("文件已被别处改动");
    await user.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(api.readFile).toHaveBeenCalled());
  });
});