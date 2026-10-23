import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(async () => []),
    listWorkflows: vi.fn(async () => []),
  },
}));

import { api } from "../api";
import TreePane from "./TreePane";
import { useFiles } from "../store/files";
import type { ContextWorkflow } from "../types";

type TreePaneProps = ComponentProps<typeof TreePane>;

const baseProps = (over: Partial<TreePaneProps> = {}): TreePaneProps => ({
  page: "library",
  novelId: 1,
  chapters: [],
  selectedChapterId: null,
  activeFile: null,
  briefRows: [],
  settingFiles: [],
  charactersOpen: false,
  feedbackOpen: false,
  creatingChapter: false,
  createError: null,
  onOpenFile: vi.fn(),
  onSelectChapter: vi.fn(),
  onCreateChapter: vi.fn(),
  onNewConversation: vi.fn(),
  conversations: [],
  activeConversation: null,
  onSelectConversation: vi.fn(),
  onOpenConversationDetail: vi.fn(),
  onRenameChapter: vi.fn(),
  onInsertChapterAfter: vi.fn(),
  onExport: vi.fn(),
  onExportDocument: vi.fn(),
  onDeleteChapter: vi.fn(),
  onRenumber: vi.fn(),
  renumberNeeded: false,
  exportError: null,
  onOpenCharacters: vi.fn(),
  onOpenWorkflow: vi.fn(),
  onOpenFeedback: vi.fn(),
  onOpenWorldview: vi.fn(),
  onOpenForeshadow: vi.fn(),
  worldviewOpen: false,
  foreshadowOpen: false,
  ...over,
});

const result = {
  source: "character",
  label: "林砚",
  path: "settings/characters/林砚.md",
  snippet: "外冷内热。",
  status: "approved",
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => (
    url.includes("/settings-search") ? [result] : []
  ));
  useFiles.setState({ novelId: 1, entries: {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TreePane settings search", () => {
  it("opens the floating window with matches and opens the chosen file", async () => {
    const props = baseProps();
    render(<TreePane {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const input = screen.getByRole("searchbox", { name: "搜索" });
    fireEvent.change(input, { target: { value: "林" } });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/api/novels/1/settings-search?q=%E6%9E%97");
    });
    const window = await screen.findByRole("dialog", { name: "搜索设定 · 林" });
    fireEvent.click(within(window).getByRole("button", { name: /林砚/ }));
    expect(props.onOpenFile).toHaveBeenCalledWith("settings/characters/林砚.md");
  });

  it("says so when nothing matches and closes on Escape", async () => {
    vi.mocked(api.get).mockImplementation(async () => []);
    render(<TreePane {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const input = screen.getByRole("searchbox", { name: "搜索" });
    fireEvent.change(input, { target: { value: "无此人" } });

    expect(await screen.findByText("没有匹配的设定")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "搜索" })).toBeNull();
    expect(screen.getByRole("button", { name: "搜索" })).toBeTruthy();
  });
});

describe("TreePane workflow navigation", () => {
  it("ignores a workflow list response from the previous book under StrictMode", async () => {
    let resolveOld!: (items: ContextWorkflow[]) => void;
    let resolveCurrent!: (items: ContextWorkflow[]) => void;
    vi.mocked(api.listWorkflows).mockImplementation((novelId) => new Promise<ContextWorkflow[]>((resolve) => {
      if (novelId === 1) resolveOld = resolve;
      else resolveCurrent = resolve;
    }));
    const oldBook = {
      id: 101, novel_id: 1, revision: 1, name: "旧书流程", purpose: "generation" as const,
      is_default: false, graph: { version: 1 as const, nodes: [], edges: [] }, created_at: "", updated_at: "",
    };
    const currentBook = {
      ...oldBook, id: 201, novel_id: 2, name: "当前书流程", is_default: true,
    };
    const props = baseProps({ page: "workflow", novelId: 1 });
    const view = render(<StrictMode><TreePane {...props} /></StrictMode>);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    view.rerender(<StrictMode><TreePane {...props} novelId={2} /></StrictMode>);
    await waitFor(() => expect(resolveCurrent).toBeTypeOf("function"));

    await act(async () => resolveCurrent([currentBook]));
    expect(await screen.findByTitle("当前书流程")).toBeTruthy();
    await act(async () => resolveOld([oldBook]));
    await waitFor(() => expect(screen.queryByTitle("旧书流程")).toBeNull());
    expect(screen.getByTitle("当前书流程")).toBeTruthy();
  });
});
