import { StrictMode, useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContextWorkflowPanel from "./ContextWorkflowPanel";
import { ToastProvider } from "./ui";
import { useWorkbench } from "../store/workbench";

type ProbeNode = { id: string; data: { error: string | null } };
const probe = vi.hoisted(() => ({
  notifications: 0,
  clickNode: null as ((node: { id: string }) => void) | null,
  connect: null as ((connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => void) | null,
  select: null as ((selection: { nodes: { id: string }[]; edges: { id: string }[] }) => void) | null,
  flow: {
    zoomIn: vi.fn(), zoomOut: vi.fn(), setViewport: vi.fn(), fitView: vi.fn(),
    screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })),
  },
}));
// Match React Flow's SelectionListener effect dependency on the callback.
// Bound the old loop so a regression fails promptly rather than hanging CI.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ onSelectionChange, onInit, onConnect, onNodeClick, children, nodes, edges }: { onSelectionChange: (selection: { nodes: { id: string }[]; edges: { id: string }[] }) => void; onInit: (flow: unknown) => void; onConnect: (connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => void; onNodeClick: (_event: unknown, node: { id: string }) => void; children: ReactNode; nodes: ProbeNode[]; edges: unknown[] }) => {
    useEffect(() => { onInit(probe.flow); }, [onInit]);
    useEffect(() => { probe.connect = onConnect; }, [onConnect]);
    useEffect(() => { probe.clickNode = (node) => onNodeClick({}, node as never); }, [onNodeClick]);
    useEffect(() => { probe.select = onSelectionChange; }, [onSelectionChange]);
    useEffect(() => {
      probe.notifications++;
      if (probe.notifications < 12) onSelectionChange({ nodes: [], edges: [] });
    }, [onSelectionChange]);
    return <div data-testid="flow" data-node-count={nodes.length} data-edge-count={edges.length}>
      {children}
      {nodes.map((node) => <span key={node.id} data-testid={`node-${node.id}`} data-error={node.data.error ?? ""} />)}
    </div>;
  },
  Background: () => null, Controls: () => null, Handle: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Position: { Left: "left", Right: "right" },
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
}));

function Harness() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/")}>返回书架</button><ContextWorkflowPanel /></>;
}

describe("Workflow browser comments", () => {
  beforeEach(() => {
    probe.notifications = 0;
    probe.clickNode = null;
    vi.clearAllMocks();
    useWorkbench.setState({ selectedNovelId: 1, selectedWorkflowId: null, workflowRefreshEpoch: 0, workflowCommand: null });
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(
      JSON.stringify(url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []),
      { headers: { "Content-Type": "application/json" } },
    ))));
  });

  it("F-06 selection notifications settle and a mounted canvas can return to the shelf", async () => {
    render(<StrictMode><MemoryRouter initialEntries={["/novels/1"]}><Routes>
      <Route path="/novels/:id" element={<Harness />} />
      <Route path="/" element={<h1>我的作品</h1>} />
    </Routes></MemoryRouter></StrictMode>);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
    await act(async () => {});
    expect(probe.notifications).toBeLessThan(5);
    fireEvent.click(screen.getByRole("button", { name: "返回书架" }));
    expect(await screen.findByRole("heading", { name: "我的作品" })).toBeTruthy();
  });

  it("F-04 keeps creation in one menu, enforces unique nodes and supports undo", async () => {
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5"));
    expect(screen.queryByRole("button", { name: "提示词模板" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加节点" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    expect((screen.getByRole("menuitem", { name: "开始" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "提示词模板" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("6");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5");
  });

  it("F-04 offers the same six types through canvas right click and Escape closes the menu", async () => {
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5"));
    fireEvent.contextMenu(screen.getByLabelText("工作流画布"), { clientX: 60, clientY: 80 });
    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("F-05 provides exactly one shared control group wired to zoom and fit", async () => {
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5"));
    expect(screen.getByRole("group", { name: "画布视图" }).querySelectorAll("button")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));
    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.click(screen.getByRole("button", { name: "适配全图" }));
    expect(probe.flow.zoomIn).toHaveBeenCalledTimes(1);
    expect(probe.flow.zoomOut).toHaveBeenCalledTimes(1);
    expect(probe.flow.setViewport).toHaveBeenCalled();
  });

  // B11 supersedes the B09 model-panel placement only; output min_chars stays in its own node unchanged.
  it("B11 edits minimum and maximum output tokens symmetrically on the model", async () => {
    const graph = { version: 1 as const, nodes: [
      { id: "start", type: "start" as const, label: "开始", position: { x: 0, y: 0 }, config: {} },
      { id: "context", type: "context" as const, label: "上下文", position: { x: 200, y: 0 }, config: {} },
      { id: "prompt", type: "prompt" as const, label: "提示词", position: { x: 400, y: 0 }, config: {} },
      { id: "model", type: "model" as const, label: "模型调用", position: { x: 600, y: 0 }, config: { max_output_tokens: 4096 } },
      { id: "output", type: "output" as const, label: "章节正文", position: { x: 800, y: 0 }, config: { format: "text", min_chars: 2500, max_chars: 0 } },
      { id: "modelB", type: "model" as const, label: "分支模型", position: { x: 600, y: 200 }, config: {} },
      { id: "outputB", type: "output" as const, label: "分支正文", position: { x: 800, y: 200 }, config: { format: "text", min_chars: 1400, max_chars: 0 } },
    ], edges: [
      { source: "start", target: "context" }, { source: "context", target: "prompt" },
      { source: "prompt", target: "model" }, { source: "model", target: "output" },
      { source: "prompt", target: "modelB" }, { source: "modelB", target: "outputB" },
    ] };
    const workflow = { id: 12, revision: 4, name: "正文流程", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 2, graph, created_at: "", updated_at: "" };
    const commands: { url: string; payload: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/commands/")) {
        const body = JSON.parse(String(init?.body));
        commands.push({ url, payload: body.payload });
        return Promise.resolve(new Response(JSON.stringify({ id: 5, result: { workflow: { ...workflow, revision: 5, graph: body.payload.graph } } }), { headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify(url.includes("/api/workflows") ? [workflow] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } }));
    }));
    useWorkbench.setState({ selectedWorkflowId: 12, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await screen.findByText("正文流程");
    act(() => probe.clickNode?.({ id: "model" }));
    expect((await screen.findByLabelText("最小输出 Token") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("最大输出 Token") as HTMLInputElement).value).toBe("4096");
    fireEvent.change(screen.getByLabelText("最小输出 Token"), { target: { value: "3000" } });
    act(() => probe.clickNode?.({ id: "output" }));
    expect((screen.getByLabelText("最少字数") as HTMLInputElement).value).toBe("2500");
    act(() => probe.clickNode?.({ id: "model" }));
    expect((screen.getByLabelText("最小输出 Token") as HTMLInputElement).value).toBe("3000");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    const savedGraph = commands[0].payload.graph as typeof graph;
    expect((savedGraph.nodes.find((node) => node.id === "model")?.config as Record<string, unknown>).min_output_tokens).toBe(3000);
    expect(savedGraph.nodes.find((node) => node.id === "output")?.config.min_chars).toBe(2500);
    expect(savedGraph.nodes.find((node) => node.id === "outputB")?.config.min_chars).toBe(1400);
  });

  it("B11 gives every model symmetric token fields without a separate explanation section", async () => {
    const graph = { version: 1 as const, nodes: [
      { id: "model", type: "model" as const, label: "模型调用", position: { x: 0, y: 0 }, config: {} },
      { id: "review", type: "output" as const, label: "自检问题", position: { x: 200, y: 0 }, config: { format: "review_issues", min_chars: 9999, max_chars: 1 } },
    ], edges: [{ source: "model", target: "review" }] };
    const workflow = { id: 13, revision: 1, name: "自检流程", novel_id: 1, purpose: "review" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" };
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("/api/workflows") ? [workflow] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } }))));
    useWorkbench.setState({ selectedWorkflowId: 13, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await screen.findByText("自检流程");
    act(() => probe.clickNode?.({ id: "model" }));
    expect(await screen.findByLabelText("最小输出 Token")).toBeTruthy();
    expect(screen.getByLabelText("最大输出 Token")).toBeTruthy();
    expect(screen.queryByText("正文候选字数")).toBeNull();
    expect(screen.queryByText(/字数不等于 Token/)).toBeNull();
    expect(screen.queryByLabelText("最多字数")).toBeNull();
  });

  // B11 supersedes B09's model-to-output traversal UI; only model token bounds belong in this inspector.
  it("B11 keeps multi-output character bounds out of the model inspector", async () => {
    const graph = { version: 1 as const, nodes: [
      { id: "model", type: "model" as const, label: "模型调用", position: { x: 0, y: 0 }, config: {} },
      { id: "outA", type: "output" as const, label: "正文A", position: { x: 200, y: 0 }, config: { format: "text", min_chars: 1000 } },
      { id: "outB", type: "output" as const, label: "正文B", position: { x: 200, y: 160 }, config: { format: "text", min_chars: 2000 } },
    ], edges: [{ source: "model", target: "outA" }, { source: "model", target: "outB" }] };
    const workflow = { id: 14, revision: 1, name: "多出口正文", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" };
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("/api/workflows") ? [workflow] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } }))));
    useWorkbench.setState({ selectedWorkflowId: 14, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await screen.findByText("多出口正文");
    act(() => probe.clickNode?.({ id: "model" }));
    expect(await screen.findByLabelText("最小输出 Token")).toBeTruthy();
    expect(screen.getByLabelText("最大输出 Token")).toBeTruthy();
    expect(screen.queryByText("正文A（outA）")).toBeNull();
    expect(screen.queryByText("正文B（outB）")).toBeNull();
    expect(screen.queryByLabelText("最少字数")).toBeNull();
  });

  it("V-19 rejects port-type, cycle and output connections with a reason beside the node", async () => {
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("4"));
    expect(probe.connect).toBeTruthy();
    act(() => probe.connect!({ source: "model", target: "start" }));
    expect(screen.getByTestId("node-start").getAttribute("data-error")).toBe("开始节点没有输入端口");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("4");

    act(() => probe.connect!({ source: "model", target: "context" }));
    expect(screen.getByTestId("node-context").getAttribute("data-error")).toBe("这条连线会形成环路");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("4");

    act(() => probe.connect!({ source: "output", target: "prompt" }));
    expect(screen.getByTestId("node-output").getAttribute("data-error")).toBe("输出节点没有输出端口");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("4");

    act(() => probe.connect!({ source: "start", target: "model" }));
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("5");
    expect(screen.getByTestId("node-start").getAttribute("data-error")).toBe("");
  });

  it("V-19 deletes the selection once and pastes copied nodes without leaking undo steps", async () => {
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5"));
    expect(probe.select).toBeTruthy();

    act(() => probe.select!({ nodes: [{ id: "prompt" }], edges: [] }));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("4");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("2");
    // Focus falls to <body> once the focused node unmounts; Ctrl+Z must still land.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("4");

    act(() => probe.select!({ nodes: [{ id: "prompt" }, { id: "model" }], edges: [] }));
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("7");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("5");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByTestId("flow").getAttribute("data-node-count")).toBe("5");
    expect(screen.getByTestId("flow").getAttribute("data-edge-count")).toBe("4");
  });

  it("V-19 keeps a new review draft after the tree selection settles and saves it as review", async () => {
    const savedGeneration = {
      id: 7, revision: 2, name: "旧正文生成", novel_id: 1, purpose: "generation" as const,
      is_default: true, created_at: "", updated_at: "",
      graph: { version: 1 as const, nodes: [
        { id: "start", type: "start" as const, label: "开始", position: { x: 0, y: 0 }, config: {} },
        { id: "context", type: "context" as const, label: "动态上下文", position: { x: 200, y: 0 }, config: { token_budget: 8000, policy: { modules: [] } } },
        { id: "prompt", type: "prompt" as const, label: "章节提示词", position: { x: 400, y: 0 }, config: { template: "写 {{input}}" } },
        { id: "model", type: "model" as const, label: "调用模型", position: { x: 600, y: 0 }, config: {} },
        { id: "output", type: "output" as const, label: "输出", position: { x: 800, y: 0 }, config: {} },
      ], edges: [
        { source: "start", target: "context" },
        { source: "context", target: "prompt" },
        { source: "prompt", target: "model" },
        { source: "model", target: "output" },
      ] },
    };
    const created = { ...savedGeneration, id: 9, revision: 1, name: "新工作流", purpose: "review" as const, is_default: false };
    const commands: { url: string; body: { payload: Record<string, unknown> } }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/commands/")) {
        commands.push({ url, body: JSON.parse(String(init?.body)) });
        return Promise.resolve(new Response(JSON.stringify({ id: 5, result: { workflow: created } }), { headers: { "Content-Type": "application/json" } }));
      }
      const body = url.includes("/api/workflows")
        ? [savedGeneration, ...(commands.length ? [created] : [])]
        : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : [];
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
    }));
    useWorkbench.setState({ selectedWorkflowId: 7, workflowCreateEpoch: 0, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByText("旧正文生成")).toBeTruthy());

    act(() => { useWorkbench.getState().requestNewWorkflow(); });
    fireEvent.click(await screen.findByRole("button", { name: "工作流类型" }));
    fireEvent.click(screen.getByRole("option", { name: "AI 自检" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await act(async () => {});

    expect(screen.getByText("新工作流")).toBeTruthy();
    expect(screen.getByText("AI 自检")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0].url).toContain("/api/commands/workflow.create/execute");
    expect(commands[0].body.payload.purpose).toBe("review");
  });

  it("B-03 explicitly binds a published workflow and refreshes the selected resource", async () => {
    const graph = { version: 1 as const, nodes: [
      { id: "start", type: "start" as const, label: "开始", position: { x: 0, y: 0 }, config: {} },
      { id: "context", type: "context" as const, label: "动态上下文", position: { x: 200, y: 0 }, config: {} },
      { id: "prompt", type: "prompt" as const, label: "提示词模板", position: { x: 400, y: 0 }, config: {} },
      { id: "model", type: "model" as const, label: "模型调用", position: { x: 600, y: 0 }, config: {} },
      { id: "output", type: "output" as const, label: "输出", position: { x: 800, y: 0 }, config: {} },
    ], edges: [] };
    const current = { id: 1, revision: 4, name: "系统 · 正文生成", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 2, graph, created_at: "", updated_at: "" };
    const target = { ...current, id: 2, revision: 7, name: "备用正文", is_default: false, published_version: 3 };
    const bound = { ...target, revision: 8, is_default: true };
    const commands: { url: string; body: { payload: Record<string, unknown> } }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/commands/")) {
        commands.push({ url, body: JSON.parse(String(init?.body)) });
        return Promise.resolve(new Response(JSON.stringify({ id: 10, result: { workflow: bound } }), { headers: { "Content-Type": "application/json" } }));
      }
      const items = url.includes("/api/workflows") ? [current, ...(commands.length ? [bound] : [target])] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : [];
      return Promise.resolve(new Response(JSON.stringify(items), { headers: { "Content-Type": "application/json" } }));
    }));
    useWorkbench.setState({ selectedWorkflowId: 1, workflowRefreshEpoch: 0, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await screen.findByText("系统 · 正文生成");
    act(() => { useWorkbench.setState({ selectedWorkflowId: 2, workflowSelectionNonce: 1 }); });
    await screen.findByText("备用正文");
    fireEvent.click(screen.getByRole("button", { name: /设为当前正文生成流程/ }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0].url).toContain("/api/commands/workflow.set_default/execute");
    expect(commands[0].body.payload).toMatchObject({ workflow_id: 2, base_revision: 7 });
    await waitFor(() => expect(useWorkbench.getState().workflowRefreshEpoch).toBe(1));
    expect(useWorkbench.getState().selectedWorkflowId).toBe(2);
    expect(await screen.findByText("备用正文")).toBeTruthy();
  });

  it("B-03 blocks unpublished workflows and explains that publishing is required", async () => {
    const graph = { version: 1 as const, nodes: [], edges: [] };
    const workflows = [
      { id: 1, revision: 1, name: "当前正文", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" },
      { id: 2, revision: 3, name: "未发布正文", novel_id: 1, purpose: "generation" as const, is_default: false, published_version: null, graph, created_at: "", updated_at: "" },
    ];
    const fetchMock = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("/api/workflows") ? workflows : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    useWorkbench.setState({ selectedWorkflowId: 1, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    act(() => { useWorkbench.setState({ selectedWorkflowId: 2, workflowSelectionNonce: 1 }); });
    await screen.findByText("未发布正文");
    const button = await screen.findByRole("button", { name: /先发布再使用正文生成流程/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("workflow.set_default"))).toBe(false);
  });

  it("B-03 preserves an unsaved policy when a right-click bind targets another workflow", async () => {
    const graph = (purpose: "generation" | "review") => ({ version: 1 as const, nodes: [
      { id: "start", type: "start" as const, label: "开始", position: { x: 0, y: 0 }, config: {} },
      { id: "context", type: "context" as const, label: "动态上下文", position: { x: 200, y: 0 }, config: { token_budget: 8000, policy: { version: 1, budget: 60000, modules: [{ id: "blueprint", kind: "blueprint", enabled: true }] } } },
      { id: "prompt", type: "prompt" as const, label: "提示词模板", position: { x: 400, y: 0 }, config: {} },
      { id: "model", type: "model" as const, label: "模型调用", position: { x: 600, y: 0 }, config: {} },
      { id: "output", type: "output" as const, label: "输出", position: { x: 800, y: 0 }, config: {} },
    ], edges: [], purpose });
    const generationGraph = graph("generation");
    const reviewGraph = graph("review");
    const current = { id: 1, revision: 4, name: "当前正文", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 2, graph: generationGraph, created_at: "", updated_at: "" };
    const target = { id: 2, revision: 7, name: "当前自检", novel_id: 1, purpose: "review" as const, is_default: true, published_version: 3, graph: reviewGraph, created_at: "", updated_at: "" };
    const fetchMock = vi.fn((url: string) => {
      const response = new Response(JSON.stringify(url.includes("/api/workflows") ? [current, target] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } });
      return url.includes("/api/workflows")
        ? new Promise<Response>((resolve) => window.setTimeout(() => resolve(response), 10))
        : Promise.resolve(response);
    });
    vi.stubGlobal("fetch", fetchMock);
    useWorkbench.setState({ selectedWorkflowId: 1, workflowCommand: null });
    render(<ToastProvider><StrictMode><ContextWorkflowPanel /></StrictMode></ToastProvider>);
    await screen.findByText("当前正文");
    fireEvent.change(screen.getByLabelText("预算"), { target: { value: "59999" } });
    expect((screen.getByLabelText("预算") as HTMLInputElement).value).toBe("59999");
    await act(async () => {
      useWorkbench.getState().requestWorkflowCommand("default", 2);
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    expect(await screen.findByText("请先保存当前画布，再切换当前流程")).toBeTruthy();
    expect((screen.getByLabelText("预算") as HTMLInputElement).value).toBe("59999");
    expect(useWorkbench.getState().selectedWorkflowId).toBe(1);
    expect((screen.getByRole("button", { name: "撤销" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("workflow.set_default"))).toBe(false);
  });

  it("B-03 editing or selecting a workflow does not bind it", async () => {
    const graph = { version: 1 as const, nodes: [], edges: [] };
    const current = { id: 1, revision: 1, name: "当前正文", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" };
    const target = { ...current, id: 2, revision: 2, name: "备用正文", is_default: false };
    const fetchMock = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("/api/workflows") ? [current, target] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    useWorkbench.setState({ selectedWorkflowId: 1, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await screen.findByText("当前正文");
    act(() => { useWorkbench.setState({ selectedWorkflowId: 2, workflowSelectionNonce: 1 }); });
    await screen.findByText("备用正文");
    expect(useWorkbench.getState().selectedWorkflowId).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("workflow.set_default"))).toBe(false);
  });

  it("B-08 ignores old-book workflow responses that resolve after switching books", async () => {
    const graph = { version: 1 as const, nodes: [], edges: [] };
    const workflow = (id: number, novel_id: number, name: string) => ({ id, revision: 1, name, novel_id, purpose: "generation" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" });
    const oldBook = workflow(11, 1, "旧书流程");
    const newBook = workflow(22, 2, "新书流程");
    const pending = new Map<number, ((response: Response) => void)[]>();
    const commands: { url: string; payload: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/workflows?novel_id=")) {
        const id = Number(url.split("novel_id=")[1]);
        if (commands.length && id === 2) return Promise.resolve(new Response(JSON.stringify([newBook]), { headers: { "Content-Type": "application/json" } }));
        return new Promise<Response>((resolve) => pending.set(id, [...(pending.get(id) ?? []), resolve]));
      }
      if (url.startsWith("/api/commands/")) {
        const body = JSON.parse(String(init?.body));
        commands.push({ url, payload: body.payload });
        return Promise.resolve(new Response(JSON.stringify({ id: 1, result: { workflow: { ...newBook, ...body.payload } } }), { headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify(url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } }));
    }));
    useWorkbench.setState({ selectedNovelId: 1, selectedWorkflowId: null, workflowRefreshEpoch: 0, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await waitFor(() => expect(pending.get(1)?.length).toBe(2));
    act(() => { useWorkbench.setState({ selectedNovelId: 2, selectedWorkflowId: null }); });
    await waitFor(() => expect(pending.get(2)?.length).toBe(1));
    await act(async () => { pending.get(2)!.forEach((resolve) => resolve(new Response(JSON.stringify([newBook]), { headers: { "Content-Type": "application/json" } }))); });
    expect(await screen.findByText("新书流程")).toBeTruthy();
    await act(async () => { pending.get(1)!.forEach((resolve) => resolve(new Response(JSON.stringify([oldBook]), { headers: { "Content-Type": "application/json" } }))); });
    expect(screen.getByText("新书流程")).toBeTruthy();
    expect(screen.queryByText("旧书流程")).toBeNull();
    expect(useWorkbench.getState().selectedWorkflowId).toBe(22);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0].url).toContain("workflow.save/execute");
    expect(commands[0].payload).toMatchObject({ workflow_id: 22, novel_id: 2 });
  });

  it("B-08 suppresses an obsolete same-book reload error after a newer response succeeds", async () => {
    const graph = { version: 1 as const, nodes: [], edges: [] };
    const current = { id: 1, revision: 1, name: "当前流程", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" };
    const pending: { resolve: (response: Response) => void; reject: (cause: Error) => void }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/workflows?")) return new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }));
      return Promise.resolve(new Response(JSON.stringify(url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } }));
    }));
    render(<ToastProvider><StrictMode><ContextWorkflowPanel /></StrictMode></ToastProvider>);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1].resolve(new Response(JSON.stringify([current]), { headers: { "Content-Type": "application/json" } })); });
    expect(await screen.findByText("当前流程")).toBeTruthy();
    await act(async () => { pending[0].reject(new Error("旧请求失败")); });
    expect(screen.queryByText("旧请求失败")).toBeNull();
    expect(screen.getByText("当前流程")).toBeTruthy();
  });

  it("B-08 does not notify a reselected book when an old save completes after an A-to-B-to-A switch", async () => {
    const graph = { version: 1 as const, nodes: [], edges: [] };
    const oldBook = { id: 1, revision: 1, name: "旧书流程", novel_id: 1, purpose: "generation" as const, is_default: true, published_version: 1, graph, created_at: "", updated_at: "" };
    const newBook = { ...oldBook, id: 22, name: "新书流程", novel_id: 2 };
    const returnedBook = { ...oldBook, id: 12, name: "重新选择的甲流程" };
    let finishSave: ((response: Response) => void) | undefined;
    const commands: string[] = [];
    let oldBookReads = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("/api/commands/")) {
        commands.push(url);
        return new Promise<Response>((resolve) => { finishSave = resolve; });
      }
      if (url.includes("/api/workflows?novel_id=1")) {
        oldBookReads += 1;
        return Promise.resolve(new Response(JSON.stringify([oldBookReads <= 2 ? oldBook : returnedBook]), { headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify(url.includes("/api/workflows") ? [newBook] : url.includes("/api/config/llm") ? { providers: [], catalogs: {} } : []), { headers: { "Content-Type": "application/json" } }));
    }));
    useWorkbench.setState({ selectedNovelId: 1, selectedWorkflowId: null, workflowRefreshEpoch: 0, workflowCommand: null });
    render(<StrictMode><ContextWorkflowPanel /></StrictMode>);
    await screen.findByText("旧书流程");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    act(() => { useWorkbench.setState({ selectedNovelId: 2, selectedWorkflowId: null }); });
    await screen.findByText("新书流程");
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
    act(() => { useWorkbench.setState({ selectedNovelId: 1, selectedWorkflowId: null }); });
    await screen.findByText("重新选择的甲流程");
    await act(async () => {
      finishSave!(new Response(JSON.stringify({ id: 1, result: { workflow: oldBook } }), { headers: { "Content-Type": "application/json" } }));
    });
    expect(useWorkbench.getState().selectedNovelId).toBe(1);
    expect(useWorkbench.getState().selectedWorkflowId).toBe(12);
    expect(useWorkbench.getState().workflowRefreshEpoch).toBe(0);
    expect(screen.getByText("重新选择的甲流程")).toBeTruthy();
  });
});
