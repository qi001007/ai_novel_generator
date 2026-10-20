import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Copy, Maximize2, Minimize2, Plus, Redo2, Trash2, Undo2, Unlink } from "lucide-react";
import "@xyflow/react/dist/style.css";

import { api } from "../api";
import { useWorkbench } from "../store/workbench";
import type { ContextModule, ContextSourceKind, ContextWorkflow, ContextWorkflowNode, ContextWorkflowPayload, WorkflowRun, WorkflowVersion } from "../types";
import JsonCodeEditor from "./JsonCodeEditor";
import { Button, Checkbox, Combobox, Dialog, IconButton, Popover, Splitter, TextField, useToast } from "./ui";

type WorkflowPurpose = ContextWorkflow["purpose"];
type NodeType = ContextWorkflowNode["type"];
type WorkflowGraph = ContextWorkflow["graph"];
type WorkflowNodeData = { label: string; nodeType: NodeType; branches: string[] };
type MenuState = { x: number; y: number; nodeId?: string } | null;
type ModuleWindow = { x: number; y: number; z: number };
type LlmConfig = {
  providers: { id: string; name: string }[];
  catalogs: Record<string, { models: string[]; fetched_at: string }>;
};

const NODE_LABELS: Record<NodeType, string> = {
  start: "开始",
  context: "动态上下文",
  prompt: "提示词模板",
  model: "模型调用",
  condition: "条件判断",
  output: "输出",
};
const NODE_TYPES = Object.keys(NODE_LABELS) as NodeType[];
const PURPOSE_LABELS: Record<WorkflowPurpose, string> = { generation: "正文生成", review: "AI 自检" };
const PROTECTED_TYPES: NodeType[] = ["start", "context"];
const SOURCES: { kind: ContextSourceKind; label: string }[] = [
  { kind: "blueprint", label: "全书主线" },
  { kind: "toc", label: "目录" },
  { kind: "arc", label: "剧情弧" },
  { kind: "briefs", label: "章节规划" },
  { kind: "drafts", label: "邻近正文" },
  { kind: "characters", label: "人物" },
  { kind: "worldview", label: "世界观" },
  { kind: "foreshadow", label: "伏笔" },
  { kind: "author_instructions", label: "作者约束" },
];

const DEFAULT_MODULES: ContextModule[] = SOURCES.map(({ kind }) => ({
  id: kind,
  kind,
  enabled: true,
  before: kind === "toc" || kind === "arc" ? 10 : kind === "briefs" || kind === "drafts" ? 2 : 0,
  after: kind === "toc" || kind === "arc" ? 10 : 0,
  tail_chars: kind === "drafts" ? 4000 : null,
  limit: null,
  selection: kind === "characters" ? "brief_mentions" : "all",
  ...(kind === "arc" ? { arc_window: 10, arc_update_threshold: "2/3" as const } : {}),
}));

function defaultPolicy() {
  return { version: 1 as const, budget: 60000, modules: DEFAULT_MODULES };
}

function nodeConfig(type: NodeType, purpose: WorkflowPurpose): Record<string, unknown> {
  if (type === "start") return { inputs: ["chapter_number", "request"] };
  if (type === "context") return { task_type: purpose === "generation" ? "generate" : "review", token_budget: 8000, policy: defaultPolicy() };
  if (type === "prompt") return { template: purpose === "generation" ? "请根据上下文与用户要求续写正文：\n{{input}}" : "请检查正文并输出结构化问题：\n{{input}}" };
  if (type === "model") return { provider_id: "", model_id: "", temperature: purpose === "generation" ? 0.7 : 0.2, max_output_tokens: purpose === "generation" ? 4096 : 2048, output_schema: purpose === "review" ? "review_issues" : "text" };
  if (type === "condition") return { branches: [{ id: "match", value: "$input.status", operator: "equals", expected: "ok" }] };
  return { format: purpose === "generation" ? "text" : "review_issues" };
}

function defaultPayload(novelId: number, purpose: WorkflowPurpose, name: string): ContextWorkflowPayload {
  const nodes: ContextWorkflowNode[] = [
    { id: "start", type: "start", label: "开始", position: { x: 20, y: 180 }, config: nodeConfig("start", purpose) },
    { id: "context", type: "context", label: "动态上下文", position: { x: 220, y: 180 }, config: nodeConfig("context", purpose) },
    { id: "prompt", type: "prompt", label: purpose === "generation" ? "章节提示词" : "自检提示词", position: { x: 440, y: 180 }, config: nodeConfig("prompt", purpose) },
    { id: "model", type: "model", label: "调用模型", position: { x: 660, y: 180 }, config: nodeConfig("model", purpose) },
    { id: "output", type: "output", label: "输出", position: { x: 860, y: 180 }, config: nodeConfig("output", purpose) },
  ];
  return { name, novel_id: novelId, purpose, is_default: false, graph: { version: 1, nodes, edges: [
    { source: "start", target: "context" },
    { source: "context", target: "prompt" },
    { source: "prompt", target: "model" },
    { source: "model", target: "output" },
  ] } };
}

function branchesOf(node: ContextWorkflowNode): string[] {
  if (node.type !== "condition") return [];
  const branches = Array.isArray(node.config?.branches)
    ? node.config.branches.map((branch) => String((branch as { id?: unknown }).id ?? "")).filter(Boolean)
    : [];
  return [...branches, String(node.config?.default_branch ?? "else")];
}

function WorkflowNodeCard({ data }: NodeProps<Node<WorkflowNodeData>>) {
  return <div className="workflow-node-card" data-node-type={data.nodeType}>
    {data.nodeType !== "start" ? <Handle type="target" position={Position.Left} /> : null}
    <span className="workflow-node-kind">{NODE_LABELS[data.nodeType]}</span>
    <strong>{data.label}</strong>
    {data.nodeType === "condition" ? data.branches.map((branch, index) => <Handle
      id={branch}
      key={branch}
      type="source"
      position={Position.Right}
      title={branch}
      style={{ top: `${((index + 1) / (data.branches.length + 1)) * 100}%` }}
    />) : data.nodeType !== "output" ? <Handle type="source" position={Position.Right} /> : null}
  </div>;
}

const WORKFLOW_NODE_TYPES = { workflow: WorkflowNodeCard };
const WORKFLOW_NODE_SIZE = { width: 164, height: 48 };

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph);
}

function asWorkflow(value: unknown): ContextWorkflow | null {
  if (!value || typeof value !== "object") return null;
  const item = value as ContextWorkflow;
  return typeof item.id === "number" && typeof item.novel_id === "number" && (item.purpose === "generation" || item.purpose === "review") && Array.isArray(item.graph?.nodes) ? item : null;
}

export default function ContextWorkflowPanel() {
  const novelId = useWorkbench((state) => state.selectedNovelId);
  const selectedWorkflowId = useWorkbench((state) => state.selectedWorkflowId);
  const workflowCreateEpoch = useWorkbench((state) => state.workflowCreateEpoch);
  const workflowCommand = useWorkbench((state) => state.workflowCommand);
  const selectWorkflowInTree = useWorkbench((state) => state.selectWorkflow);
  const notifyWorkflowChanged = useWorkbench((state) => state.notifyWorkflowChanged);
  const { pushToast } = useToast();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragStartGraph = useRef<WorkflowGraph | null>(null);
  const clipboard = useRef<ContextWorkflowNode[]>([]);
  const commandNonce = useRef(0);
  const createEpoch = useRef(workflowCreateEpoch);
  const moduleZ = useRef(20);

  const [workflows, setWorkflows] = useState<ContextWorkflow[]>([]);
  const [draft, setDraft] = useState<ContextWorkflow | null>(null);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [menu, setMenu] = useState<MenuState>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(null);
  const [undoStack, setUndoStack] = useState<WorkflowGraph[]>([]);
  const [redoStack, setRedoStack] = useState<WorkflowGraph[]>([]);
  const [nameDialog, setNameDialog] = useState<"new" | "rename" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [purposeDraft, setPurposeDraft] = useState<WorkflowPurpose>("generation");
  const [deleteTarget, setDeleteTarget] = useState<ContextWorkflow | null>(null);
  const [promptNodeId, setPromptNodeId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({ providers: [], catalogs: {} });
  const [moduleWindows, setModuleWindows] = useState<Record<string, ModuleWindow>>({});
  const [policyHeight, setPolicyHeight] = useState(() => Number(localStorage.getItem("workflow.policyHeight")) || 210);

  const selectedNode = draft?.graph.nodes.find((node) => node.id === selectedNodeIds.at(-1)) ?? null;
  const contextNode = draft?.graph.nodes.find((node) => node.type === "context") ?? null;
  const contextPolicy = (contextNode?.config?.policy as ReturnType<typeof defaultPolicy> | undefined) ?? defaultPolicy();

  function fitWorkflowView(duration = 0) {
    const canvas = rootRef.current?.querySelector<HTMLElement>(".context-workflow-canvas");
    const nodes = draft?.graph.nodes ?? [];
    if (!flow || !canvas || nodes.length === 0) return;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + WORKFLOW_NODE_SIZE.width));
    const maxY = Math.max(...nodes.map((node) => node.position.y + WORKFLOW_NODE_SIZE.height));
    const boundsWidth = Math.max(1, maxX - minX);
    const boundsHeight = Math.max(1, maxY - minY);
    const padding = 36;
    const zoom = Math.max(0.35, Math.min(1, (canvas.clientWidth - padding * 2) / boundsWidth, (canvas.clientHeight - padding * 2) / boundsHeight));
    void flow.setViewport({
      x: (canvas.clientWidth - boundsWidth * zoom) / 2 - minX * zoom,
      y: (canvas.clientHeight - boundsHeight * zoom) / 2 - minY * zoom,
      zoom,
    }, { duration });
  }

  useEffect(() => {
    if (!flow || !draft) return;
    const frame = window.requestAnimationFrame(() => {
      fitWorkflowView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft?.id, flow]);

  const pick = useCallback((workflow: ContextWorkflow) => {
    setDraft(structuredClone(workflow));
    setSelectedNodeIds([]);
    setUndoStack([]);
    setRedoStack([]);
    setModuleWindows({});
  }, []);

  const reload = useCallback(async (preferredId?: number) => {
    if (novelId === null) return;
    const items = (await api.listWorkflows(novelId)).map(asWorkflow).filter((item): item is ContextWorkflow => item !== null);
    setWorkflows(items);
    const target = items.find((item) => item.id === (preferredId ?? selectedWorkflowId)) ?? items.find((item) => item.is_default) ?? items[0];
    if (target) {
      pick(target);
      selectWorkflowInTree(target.id);
    } else {
      pick({ id: -1, revision: 0, created_at: "", updated_at: "", ...defaultPayload(novelId, "generation", "正文生成") });
    }
  }, [novelId, pick, selectWorkflowInTree, selectedWorkflowId]);

  useEffect(() => { void reload().catch((cause: Error) => pushToast(cause.message, "error")); }, [reload, pushToast]);
  useEffect(() => {
    api.get<LlmConfig>("/api/config/llm").then(setLlmConfig).catch(() => setLlmConfig({ providers: [], catalogs: {} }));
  }, []);
  useEffect(() => {
    if (selectedWorkflowId === null || selectedWorkflowId === draft?.id) return;
    const target = workflows.find((workflow) => workflow.id === selectedWorkflowId);
    if (target) pick(target);
  }, [draft?.id, pick, selectedWorkflowId, workflows]);
  useEffect(() => {
    if (createEpoch.current === workflowCreateEpoch) return;
    createEpoch.current = workflowCreateEpoch;
    setNameDraft("新工作流");
    setPurposeDraft("generation");
    setNameDialog("new");
  }, [workflowCreateEpoch]);
  useEffect(() => {
    if (!workflowCommand || commandNonce.current === workflowCommand.nonce) return;
    commandNonce.current = workflowCommand.nonce;
    const target = workflows.find((workflow) => workflow.id === workflowCommand.workflowId);
    if (!target) return;
    pick(target);
    if (workflowCommand.action === "rename") {
      setNameDraft(target.name);
      setNameDialog("rename");
    } else if (workflowCommand.action === "default") void makeDefault(target);
    else if (workflowCommand.action === "duplicate") void duplicateWorkflow(target);
    else setDeleteTarget(target);
  }, [pick, workflowCommand, workflows]);
  useEffect(() => { localStorage.setItem("workflow.policyHeight", String(policyHeight)); }, [policyHeight]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [menu]);

  const flowNodes = useMemo<Node[]>(() => draft?.graph.nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: node.position,
    initialWidth: WORKFLOW_NODE_SIZE.width,
    initialHeight: WORKFLOW_NODE_SIZE.height,
    selected: selectedNodeIds.includes(node.id),
    data: { label: node.label, nodeType: node.type, branches: branchesOf(node) },
  })) ?? [], [draft, selectedNodeIds]);
  const flowEdges = useMemo<Edge[]>(() => draft?.graph.edges.map((edge, index) => ({
    id: `${edge.source}:${edge.source_handle ?? ""}:${edge.target}:${index}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_handle || undefined,
    targetHandle: edge.target_handle || undefined,
  })) ?? [], [draft]);

  function commitGraph(next: WorkflowGraph) {
    if (!draft) return;
    setUndoStack((stack) => [...stack.slice(-49), cloneGraph(draft.graph)]);
    setRedoStack([]);
    setDraft({ ...draft, graph: next });
  }

  function undo() {
    if (!draft || undoStack.length === 0) return;
    const next = undoStack.at(-1)!;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, cloneGraph(draft.graph)]);
    setDraft({ ...draft, graph: cloneGraph(next) });
  }

  function redo() {
    if (!draft || redoStack.length === 0) return;
    const next = redoStack.at(-1)!;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, cloneGraph(draft.graph)]);
    setDraft({ ...draft, graph: cloneGraph(next) });
  }

  function updateNode(nodeId: string, patch: Partial<ContextWorkflowNode>) {
    if (!draft) return;
    commitGraph({ ...draft.graph, nodes: draft.graph.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node) });
  }

  function updateNodeConfig(nodeId: string, patch: Record<string, unknown>) {
    const node = draft?.graph.nodes.find((item) => item.id === nodeId);
    if (node) updateNode(nodeId, { config: { ...node.config, ...patch } });
  }

  function addNode(type: NodeType, position?: { x: number; y: number }) {
    if (!draft) return;
    if ((type === "start" || type === "context") && draft.graph.nodes.some((node) => node.type === type)) {
      pushToast(`每个工作流只能有一个${NODE_LABELS[type]}节点`, "error");
      return;
    }
    let index = 1;
    while (draft.graph.nodes.some((node) => node.id === `${type}-${index}`)) index += 1;
    const node: ContextWorkflowNode = { id: `${type}-${index}`, type, label: NODE_LABELS[type], position: position ?? { x: 120 + index * 24, y: 90 + index * 36 }, config: nodeConfig(type, draft.purpose) };
    commitGraph({ ...draft.graph, nodes: [...draft.graph.nodes, node] });
    setSelectedNodeIds([node.id]);
    setMenu(null);
  }

  function removable(ids: string[]): string[] {
    if (!draft) return [];
    return ids.filter((id) => {
      const node = draft.graph.nodes.find((item) => item.id === id);
      if (!node || PROTECTED_TYPES.includes(node.type)) return false;
      if (node.type === "output" && draft.graph.nodes.filter((item) => item.type === "output").length === 1) return false;
      return true;
    });
  }

  function deleteNodes(ids = selectedNodeIds) {
    if (!draft) return;
    const allowed = removable(ids);
    if (allowed.length !== ids.length) pushToast("开始、动态上下文和最后一个输出节点不能删除", "error");
    if (allowed.length === 0) return;
    const deleted = new Set(allowed);
    commitGraph({ ...draft.graph, nodes: draft.graph.nodes.filter((node) => !deleted.has(node.id)), edges: draft.graph.edges.filter((edge) => !deleted.has(edge.source) && !deleted.has(edge.target)) });
    setSelectedNodeIds([]);
    setMenu(null);
  }

  function disconnectNode(nodeId: string) {
    if (!draft) return;
    commitGraph({ ...draft.graph, edges: draft.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId) });
    setMenu(null);
  }

  function copyNodes(ids = selectedNodeIds) {
    clipboard.current = draft?.graph.nodes.filter((node) => ids.includes(node.id) && !PROTECTED_TYPES.includes(node.type)).map((node) => structuredClone(node)) ?? [];
    if (clipboard.current.length) pushToast(`已复制 ${clipboard.current.length} 个节点`);
  }

  function pasteNodes() {
    if (!draft || clipboard.current.length === 0) return;
    const stamp = Date.now();
    const copies: ContextWorkflowNode[] = clipboard.current.map((source, offset) => ({ ...structuredClone(source), id: `${source.type}-${stamp}-${offset}`, position: { x: source.position.x + 36, y: source.position.y + 36 } }));
    commitGraph({ ...draft.graph, nodes: [...draft.graph.nodes, ...copies] });
    setSelectedNodeIds(copies.map((node) => node.id));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement) && !fullscreen) return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea") || target.isContentEditable) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNodeIds.length) { event.preventDefault(); deleteNodes(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copyNodes(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteNodes(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function changeNodes(changes: NodeChange[]) {
    setDraft((current) => {
      if (!current) return current;
      const changed = applyNodeChanges(changes.filter((change) => change.type !== "remove"), current.graph.nodes.map((node) => ({ id: node.id, position: node.position, data: {}, type: "workflow" })));
      const positions = new Map(changed.map((node) => [node.id, node.position]));
      return { ...current, graph: { ...current.graph, nodes: current.graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) } };
    });
  }

  function connect(connection: Connection) {
    if (!draft || !connection.source || !connection.target || connection.source === connection.target) return;
    const duplicate = draft.graph.edges.some((edge) => edge.source === connection.source && edge.target === connection.target && (edge.source_handle ?? "") === (connection.sourceHandle ?? ""));
    if (duplicate) return;
    commitGraph({ ...draft.graph, edges: [...draft.graph.edges, { source: connection.source, target: connection.target, source_handle: connection.sourceHandle ?? "", target_handle: connection.targetHandle ?? "" }] });
  }

  async function save() {
    if (!draft || novelId === null) return;
    setBusy(true);
    try {
      const payload: ContextWorkflowPayload = { name: draft.name.trim(), novel_id: novelId, purpose: draft.purpose, is_default: draft.is_default, graph: draft.graph };
      const operation = draft.id < 0
        ? await api.executeCommand<{ workflow: ContextWorkflow }>("workflow.create", payload, `workflow-create:${crypto.randomUUID()}`)
        : await api.executeCommand<{ workflow: ContextWorkflow }>("workflow.save", { ...payload, workflow_id: draft.id, base_revision: draft.revision }, `workflow-save:${draft.id}:${draft.revision}:${crypto.randomUUID()}`);
      const saved = operation.result.workflow;
      await reload(saved.id);
      notifyWorkflowChanged(saved.id);
      pushToast("工作流已保存", "success");
    } catch (cause) { pushToast(cause instanceof Error ? cause.message : "保存失败", "error"); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!draft || draft.id < 0) return pushToast("请先保存工作流", "error");
    setBusy(true);
    try {
      await api.validateWorkflow(draft.id);
      const operation = await api.executeCommand<{ workflow_version: WorkflowVersion }>("workflow.publish", { workflow_id: draft.id, base_revision: draft.revision }, `workflow-publish:${draft.id}:${draft.revision}:${crypto.randomUUID()}`);
      pushToast(`已发布 v${operation.result.workflow_version.version}`, "success");
    } catch (cause) { pushToast(cause instanceof Error ? cause.message : "发布失败", "error"); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!draft || draft.id < 0 || novelId === null) return pushToast("请先保存并发布工作流", "error");
    setBusy(true);
    try {
      const result = await api.runWorkflow(draft.id, novelId, { query: "工作流试运行", chapter_number: 1 });
      setLastRun(result);
      pushToast(`运行${result.status === "completed" ? "完成" : "失败"}`, result.status === "completed" ? "success" : "error");
    } catch (cause) { pushToast(cause instanceof Error ? cause.message : "运行失败", "error"); }
    finally { setBusy(false); }
  }

  async function makeDefault(target: ContextWorkflow) {
    setBusy(true);
    try {
      const operation = await api.executeCommand<{ workflow: ContextWorkflow }>("workflow.set_default", { workflow_id: target.id, base_revision: target.revision }, `workflow-default:${target.id}:${target.revision}:${crypto.randomUUID()}`);
      await reload(operation.result.workflow.id);
      notifyWorkflowChanged(operation.result.workflow.id);
      pushToast(`已设为当前${PURPOSE_LABELS[target.purpose]}流程`, "success");
    } catch (cause) { pushToast(cause instanceof Error ? cause.message : "绑定失败", "error"); }
    finally { setBusy(false); }
  }

  async function duplicateWorkflow(target: ContextWorkflow) {
    setBusy(true);
    try {
      const operation = await api.executeCommand<{ workflow: ContextWorkflow }>("workflow.create", { name: `${target.name} 副本`, novel_id: target.novel_id, purpose: target.purpose, is_default: false, graph: target.graph }, `workflow-copy:${target.id}:${crypto.randomUUID()}`);
      await reload(operation.result.workflow.id);
      notifyWorkflowChanged(operation.result.workflow.id);
      pushToast("副本已创建", "success");
    } catch (cause) { pushToast(cause instanceof Error ? cause.message : "复制失败", "error"); }
    finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.executeCommand<{ deleted: boolean }>("workflow.delete", { workflow_id: deleteTarget.id, base_revision: deleteTarget.revision }, `workflow-delete:${deleteTarget.id}:${crypto.randomUUID()}`, true);
      setDeleteTarget(null);
      await reload();
      notifyWorkflowChanged(draft?.id ?? -1);
      pushToast("工作流已删除", "success");
    } catch (cause) { pushToast(cause instanceof Error ? cause.message : "删除失败", "error"); }
    finally { setBusy(false); }
  }

  async function confirmName() {
    const name = nameDraft.trim();
    if (!name || novelId === null) return pushToast("名称不能为空", "error");
    if (nameDialog === "new") {
      pick({ id: -1, revision: 0, created_at: "", updated_at: "", ...defaultPayload(novelId, purposeDraft, name) });
    } else if (draft) {
      if (draft.id < 0) setDraft({ ...draft, name });
      else {
        setBusy(true);
        try {
          const operation = await api.executeCommand<{ workflow: ContextWorkflow }>("workflow.rename", { workflow_id: draft.id, name, base_revision: draft.revision }, `workflow-rename:${draft.id}:${crypto.randomUUID()}`);
          await reload(operation.result.workflow.id);
          notifyWorkflowChanged(operation.result.workflow.id);
        } catch (cause) { pushToast(cause instanceof Error ? cause.message : "重命名失败", "error"); }
        finally { setBusy(false); }
      }
    }
    setNameDialog(null);
  }

  function updatePolicy(next: ReturnType<typeof defaultPolicy>) {
    if (contextNode) updateNodeConfig(contextNode.id, { policy: next });
  }

  function updateModule(id: string, patch: Partial<ContextModule>) {
    updatePolicy({ ...contextPolicy, modules: contextPolicy.modules.map((module) => module.id === id ? { ...module, ...patch } : module) });
  }

  function openModule(id: string) {
    moduleZ.current += 1;
    setModuleWindows((current) => current[id]
      ? { ...current, [id]: { ...current[id], z: moduleZ.current } }
      : { ...current, [id]: { x: 16 + Object.keys(current).length * 34, y: 112 + Object.keys(current).length * 24, z: moduleZ.current } });
  }

  function dragModule(event: React.PointerEvent<HTMLElement>, id: string) {
    if ((event.target as HTMLElement).closest("button,input")) return;
    const start = moduleWindows[id];
    const sx = event.clientX;
    const sy = event.clientY;
    const root = rootRef.current?.getBoundingClientRect();
    if (!start || !root) return;
    event.preventDefault();
    const move = (next: PointerEvent) => setModuleWindows((current) => ({ ...current, [id]: { ...current[id], x: Math.max(0, Math.min(root.width - 240, start.x + next.clientX - sx)), y: Math.max(50, Math.min(root.height - 140, start.y + next.clientY - sy)) } }));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function resizePolicy(event: React.PointerEvent<HTMLDivElement>) {
    const startY = event.clientY;
    const start = policyHeight;
    const move = (next: PointerEvent) => setPolicyHeight(Math.max(140, Math.min(window.innerHeight * .55, start + startY - next.clientY)));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  if (novelId === null) return <div className="empty-state">先打开一本作品</div>;

  return <div ref={rootRef} tabIndex={-1} className={`context-workflow${fullscreen ? " is-fullscreen" : ""}`}>
    <header className="context-workflow-toolbar">
      <div className="workflow-current-title"><strong>{draft?.name ?? "未选择工作流"}</strong>{draft ? <i>{PURPOSE_LABELS[draft.purpose]}</i> : null}{draft?.is_default ? <i>当前</i> : null}</div>
      <Button compact tone="primary" disabled={busy} onClick={() => void save()}>保存</Button>
      <Button compact disabled={busy || !draft || draft.id < 0} onClick={() => void publish()}>发布</Button>
      <Button compact disabled={busy || !draft || draft.id < 0} onClick={() => void run()}>试运行</Button>
      <IconButton type="button" title="撤销" aria-label="撤销" disabled={!undoStack.length} onClick={undo}><Undo2 size={14} /></IconButton>
      <IconButton type="button" title="重做" aria-label="重做" disabled={!redoStack.length} onClick={redo}><Redo2 size={14} /></IconButton>
      <IconButton type="button" title={fullscreen ? "退出全屏" : "全屏"} aria-label={fullscreen ? "退出全屏" : "全屏"} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</IconButton>
    </header>
    <div className="workflow-viewbar">
      <span>节点</span>
      {NODE_TYPES.map((type) => {
        const uniqueExists = (type === "start" || type === "context") && Boolean(draft?.graph.nodes.some((node) => node.type === type));
        return <Button compact key={type} disabled={uniqueExists} onClick={uniqueExists ? undefined : () => addNode(type)}><Plus size={12} />{NODE_LABELS[type]}</Button>;
      })}
    </div>
    <div className="workflow-studio-grid">
      <div className="context-workflow-canvas" aria-label="工作流画布" onContextMenu={(event) => {
        event.preventDefault();
        const nodeId = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.dataset.id;
        if (nodeId) setSelectedNodeIds([nodeId]);
        setMenu({ x: event.clientX, y: event.clientY, nodeId });
      }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          fitView
          minZoom={0.35}
          maxZoom={1.8}
          multiSelectionKeyCode="Shift"
          selectionOnDrag
          panOnDrag={[1, 2]}
          onInit={setFlow}
          onNodesChange={changeNodes}
          onNodeDragStart={() => { if (draft) dragStartGraph.current = cloneGraph(draft.graph); }}
          onNodeDragStop={() => { if (dragStartGraph.current) { setUndoStack((stack) => [...stack, dragStartGraph.current!]); setRedoStack([]); dragStartGraph.current = null; } }}
          onNodeClick={(_event, node) => setSelectedNodeIds([node.id])}
          onSelectionChange={({ nodes }) => setSelectedNodeIds(nodes.map((node) => node.id))}
          onNodeContextMenu={(event, node) => { event.preventDefault(); event.stopPropagation(); setSelectedNodeIds([node.id]); setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }); }}
          onConnect={connect}
          onEdgesDelete={(deleted) => {
            if (!draft) return;
            const ids = new Set(deleted.map((edge) => edge.id));
            commitGraph({ ...draft.graph, edges: draft.graph.edges.filter((edge, index) => !ids.has(`${edge.source}:${edge.source_handle ?? ""}:${edge.target}:${index}`)) });
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <Panel position="top-right" className="context-workflow-fit-panel"><Button compact onClick={() => fitWorkflowView(180)}>适配全图</Button></Panel>
        </ReactFlow>
      </div>
      <aside className="workflow-inspector" aria-label="节点属性">
        {selectedNode ? <NodeInspector node={selectedNode} config={llmConfig} onChange={(patch) => updateNode(selectedNode.id, patch)} onConfig={(patch) => updateNodeConfig(selectedNode.id, patch)} onOpenPrompt={() => { setPromptNodeId(selectedNode.id); setPromptText(String(selectedNode.config?.template ?? "")); }} /> : <p>选择节点查看参数</p>}
      </aside>
    </div>
    {contextNode ? <>
      <Splitter orientation="horizontal" label="上下文策略高度" onPointerDown={resizePolicy} />
      <section className="context-workflow-policy" style={{ height: policyHeight }}>
        <header className="context-workflow-policy-title"><strong>上下文策略</strong><span>{contextPolicy.budget} 字符 · {contextPolicy.modules.filter((module) => module.enabled).length} 项</span></header>
        <div className="context-workflow-policy-body">
          <label className="context-budget">预算<TextField type="number" min={100} max={1000000} value={contextPolicy.budget} onChange={(event) => updatePolicy({ ...contextPolicy, budget: Number(event.target.value) })} /></label>
          <div className="context-workflow-modules">{contextPolicy.modules.map((module) => <Button compact key={module.id} className="context-workflow-module" onClick={() => openModule(module.id)}><i data-enabled={module.enabled} /><strong>{SOURCES.find((source) => source.kind === module.kind)?.label ?? module.kind}</strong></Button>)}</div>
        </div>
      </section>
    </> : null}
    {Object.entries(moduleWindows).map(([id, state]) => {
      const module = contextPolicy.modules.find((item) => item.id === id);
      if (!module) return null;
      return <section className="context-module-popover" role="dialog" aria-modal="false" key={id} style={{ transform: `translate(${state.x}px, ${state.y}px)`, zIndex: state.z }}>
        <header onPointerDown={(event) => dragModule(event, id)}><strong>{SOURCES.find((source) => source.kind === module.kind)?.label}</strong><IconButton type="button" aria-label="关闭" onClick={() => setModuleWindows((current) => { const next = { ...current }; delete next[id]; return next; })}>×</IconButton></header>
        <div className="context-workflow-module-fields"><Checkbox checked={module.enabled} onChange={(enabled) => updateModule(id, { enabled })}>启用</Checkbox>
          {(["toc", "arc", "briefs", "drafts"] as ContextSourceKind[]).includes(module.kind) ? <label>前<TextField type="number" min={0} value={module.before} onChange={(event) => updateModule(id, { before: Number(event.target.value) })} /></label> : null}
          {(["toc", "arc"] as ContextSourceKind[]).includes(module.kind) ? <label>后<TextField type="number" min={0} value={module.after} onChange={(event) => updateModule(id, { after: Number(event.target.value) })} /></label> : null}
          {module.kind === "drafts" ? <label>末尾字数<TextField type="number" min={100} value={module.tail_chars ?? 4000} onChange={(event) => updateModule(id, { tail_chars: Number(event.target.value) })} /></label> : null}
        </div>
      </section>;
    })}
    {menu ? <Popover className="workflow-canvas-menu"><div style={{ position: "fixed", left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.nodeId ? <>
        <button type="button" onClick={() => copyNodes([menu.nodeId!])}><Copy size={13} />复制</button>
        <button type="button" onClick={() => disconnectNode(menu.nodeId!)}><Unlink size={13} />断开连接</button>
        <button type="button" className="danger" onClick={() => deleteNodes([menu.nodeId!])}><Trash2 size={13} />删除</button>
      </> : NODE_TYPES.map((type) => {
        const uniqueExists = (type === "start" || type === "context") && Boolean(draft?.graph.nodes.some((node) => node.type === type));
        return <button type="button" key={type} disabled={uniqueExists} onClick={uniqueExists ? undefined : () => addNode(type, flow?.screenToFlowPosition({ x: menu.x, y: menu.y }))}><Plus size={13} />{NODE_LABELS[type]}</button>;
      })}
    </div></Popover> : null}
    {promptNodeId ? <section className="workflow-source-overlay" aria-label="提示词编辑器"><header><strong>{promptNodeId}.prompt</strong><Button compact onClick={() => setPromptNodeId(null)}>关闭</Button></header><JsonCodeEditor value={promptText} onChange={setPromptText} ariaLabel="提示词源码" /><footer><Button compact onClick={() => setPromptNodeId(null)}>取消</Button><Button compact tone="primary" onClick={() => { updateNodeConfig(promptNodeId, { template: promptText }); setPromptNodeId(null); }}>应用</Button></footer></section> : null}
    {lastRun ? <section className="workflow-run-summary" aria-label="最近运行详情"><header><strong>运行 #{lastRun.id}</strong><span>{lastRun.status}</span><span>{lastRun.token_input + lastRun.token_output} Token</span></header>{lastRun.nodes.map((node) => <div key={node.id}><span>{node.node_id}</span><span>{node.status}</span><span>{node.error || `${node.token_input + node.token_output} Token`}</span></div>)}</section> : null}
    {nameDialog ? <Dialog title={nameDialog === "new" ? "新建工作流" : "重命名"} onClose={() => setNameDialog(null)}><TextField autoFocus aria-label="工作流名称" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />{nameDialog === "new" ? <Combobox ariaLabel="工作流类型" value={purposeDraft} onChange={(value) => setPurposeDraft(value as WorkflowPurpose)} options={[{ value: "generation", label: "正文生成" }, { value: "review", label: "AI 自检" }]} /> : null}<footer><Button compact onClick={() => setNameDialog(null)}>取消</Button><Button compact tone="primary" disabled={busy} onClick={() => void confirmName()}>确认</Button></footer></Dialog> : null}
    {deleteTarget ? <Dialog title="删除工作流" onClose={() => setDeleteTarget(null)}><p>将删除“{deleteTarget.name}”；已发布或运行过的流程不会被允许删除</p><footer><Button compact onClick={() => setDeleteTarget(null)}>取消</Button><Button compact tone="danger" disabled={busy} onClick={() => void confirmDelete()}>删除</Button></footer></Dialog> : null}
  </div>;
}

function NodeInspector({ node, config, onChange, onConfig, onOpenPrompt }: {
  node: ContextWorkflowNode;
  config: LlmConfig;
  onChange: (patch: Partial<ContextWorkflowNode>) => void;
  onConfig: (patch: Record<string, unknown>) => void;
  onOpenPrompt: () => void;
}) {
  const providerId = String(node.config?.provider_id ?? "");
  const conditionBranches = Array.isArray(node.config?.branches) ? node.config.branches as { id: string; value: string; operator: string; expected?: unknown }[] : [];
  const providers = config.providers.map((provider) => ({ value: provider.id, label: provider.name || provider.id }));
  const models = (config.catalogs[providerId]?.models ?? []).map((model) => ({ value: model, label: model, detail: providerId }));
  return <>
    <header><span>{NODE_LABELS[node.type]}</span><strong>{node.id}</strong></header>
    <label>名称<TextField value={node.label} onChange={(event) => onChange({ label: event.target.value })} /></label>
    {node.type === "start" ? <label>输入变量<TextField value={(node.config?.inputs as string[] | undefined)?.join(", ") ?? ""} onChange={(event) => onConfig({ inputs: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label> : null}
    {node.type === "context" ? <><label>模型预算<TextField type="number" value={Number(node.config?.token_budget ?? 8000)} onChange={(event) => onConfig({ token_budget: Number(event.target.value) })} /></label><p>详细资料范围在画布下方设置</p></> : null}
    {node.type === "prompt" ? <><p>{String(node.config?.template ?? "").slice(0, 120) || "空提示词"}</p><Button compact tone="primary" onClick={onOpenPrompt}>在编辑器中打开</Button></> : null}
    {node.type === "model" ? <>
      <label>供应商<Combobox ariaLabel="模型供应商" value={providerId} options={providers} onChange={(value) => onConfig({ provider_id: value, model_id: "" })} placeholder="先在设置中配置" /></label>
      <label>模型<Combobox ariaLabel="模型" value={String(node.config?.model_id ?? "")} options={models} onChange={(value) => onConfig({ model_id: value })} placeholder={providerId && !config.catalogs[providerId] ? "先在设置中获取模型列表" : "选择模型"} disabled={!providerId || models.length === 0} /></label>
      <label>温度<TextField type="number" min={0} max={2} step={0.1} value={Number(node.config?.temperature ?? .7)} onChange={(event) => onConfig({ temperature: Number(event.target.value) })} /></label>
      <label>最大输出<TextField type="number" min={1} value={Number(node.config?.max_output_tokens ?? 4096)} onChange={(event) => onConfig({ max_output_tokens: Number(event.target.value) })} /></label>
    </> : null}
    {node.type === "condition" ? <>
      {conditionBranches.map((branch, index) => <div className="workflow-condition-branch" key={`${branch.id}-${index}`}>
        <label>出口<TextField value={branch.id} onChange={(event) => onConfig({ branches: conditionBranches.map((item, at) => at === index ? { ...item, id: event.target.value } : item) })} /></label>
        <label>取值<TextField value={branch.value} onChange={(event) => onConfig({ branches: conditionBranches.map((item, at) => at === index ? { ...item, value: event.target.value } : item) })} /></label>
        <label>判断<Combobox ariaLabel={`${branch.id}判断`} value={branch.operator} onChange={(value) => onConfig({ branches: conditionBranches.map((item, at) => at === index ? { ...item, operator: value } : item) })} options={[{ value: "equals", label: "等于" }, { value: "not_equals", label: "不等于" }, { value: "contains", label: "包含" }, { value: "is_empty", label: "为空" }]} /></label>
        <label>比较值<TextField value={String(branch.expected ?? "")} onChange={(event) => onConfig({ branches: conditionBranches.map((item, at) => at === index ? { ...item, expected: event.target.value } : item) })} /></label>
        <Button compact disabled={conditionBranches.length === 1} onClick={() => onConfig({ branches: conditionBranches.filter((_item, at) => at !== index) })}>删除出口</Button>
      </div>)}
      <Button compact onClick={() => onConfig({ branches: [...conditionBranches, { id: `branch_${conditionBranches.length + 1}`, value: "$input.status", operator: "equals", expected: "" }] })}>新增出口</Button>
      <p>所有条件未命中时走 else</p>
    </> : null}
    {node.type === "output" ? <label>结果格式<Combobox ariaLabel="结果格式" value={String(node.config?.format ?? "text")} onChange={(value) => onConfig({ format: value })} options={[{ value: "text", label: "正文" }, { value: "review_issues", label: "结构化自检问题" }]} /></label> : null}
  </>;
}
