"""Strict contract for the six executable novel-workflow node types."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


WorkflowPurpose = Literal["generation", "review"]
SourceKind = Literal[
    "blueprint", "toc", "arc", "briefs", "drafts", "characters",
    "worldview", "foreshadow", "author_instructions",
]
NodeType = Literal["start", "context", "prompt", "model", "condition", "output"]
CONDITION_OPERATORS = {
    "equals", "not_equals", "contains", "not_contains", "is_empty",
    "is_not_empty", "greater_than", "less_than",
}


class ContextModule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    kind: SourceKind
    enabled: bool = True
    before: int = Field(default=0, ge=0, le=1000)
    after: int = Field(default=0, ge=0, le=1000)
    tail_chars: int | None = Field(default=None, ge=1, le=100000)
    limit: int | None = Field(default=None, ge=1, le=1000)
    selection: Literal["all", "brief_mentions", "keyword_match", "manual"] = "all"
    arc_window: int | None = Field(default=None, ge=1, le=1000)
    arc_update_threshold: Literal["1/2", "2/3", "3/4"] | None = None
    arc_update_every: int | None = Field(default=None, ge=1, le=100)


class ContextPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    budget: int = Field(default=60000, ge=100, le=1_000_000)
    modules: list[ContextModule] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def unique_modules(self) -> "ContextPolicy":
        ids = [module.id for module in self.modules]
        kinds = [module.kind for module in self.modules]
        if len(ids) != len(set(ids)):
            raise ValueError("context policy module ids must be unique")
        if len(kinds) != len(set(kinds)):
            raise ValueError("context policy source kinds must be unique")
        return self


class GraphPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=-1_000_000, le=1_000_000)
    y: float = Field(ge=-1_000_000, le=1_000_000)


class WorkflowNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    type: NodeType
    position: GraphPosition
    label: str = Field(default="", max_length=120)
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_known_config(self) -> "WorkflowNode":
        if self.type == "context":
            ContextPolicy.model_validate(self.config.get("policy"))
            if "token_budget" in self.config:
                value = self.config["token_budget"]
                if not isinstance(value, int) or isinstance(value, bool) or not 100 <= value <= 1_000_000:
                    raise ValueError("context token_budget must be between 100 and 1000000")
        elif self.type == "prompt":
            if not isinstance(self.config.get("template", ""), str):
                raise ValueError("prompt template must be text")
        elif self.type == "model":
            for key in ("provider_id", "model_id"):
                value = self.config.get(key, "")
                if value is not None and not isinstance(value, str):
                    raise ValueError(f"model {key} must be text")
            if "temperature" in self.config:
                value = self.config["temperature"]
                if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 2:
                    raise ValueError("model temperature must be between 0 and 2")
            if "max_output_tokens" in self.config:
                value = self.config["max_output_tokens"]
                if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 1_000_000:
                    raise ValueError("model max_output_tokens must be a positive integer")
        elif self.type == "output":
            minimum = self.config.get("min_chars", 0)
            maximum = self.config.get("max_chars", 0)
            for label, value in (("min_chars", minimum), ("max_chars", maximum)):
                if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 1_000_000:
                    raise ValueError(f"output {label} must be a non-negative integer")
            if maximum and minimum > maximum:
                raise ValueError("output min_chars cannot exceed max_chars")
        elif self.type == "condition":
            branches = self.config.get("branches")
            if not isinstance(branches, list) or not branches:
                raise ValueError("condition nodes need at least one configured branch")
            ids: list[str] = []
            for branch in branches:
                if not isinstance(branch, dict):
                    raise ValueError("condition branches must be objects")
                branch_id = str(branch.get("id") or "")
                if not branch_id or not branch_id.replace("_", "").replace("-", "").isalnum():
                    raise ValueError("condition branch ids must be simple names")
                if branch.get("operator") not in CONDITION_OPERATORS:
                    raise ValueError("condition branch operator is not supported")
                ids.append(branch_id)
            if len(ids) != len(set(ids)) or "else" in ids:
                raise ValueError("condition branch ids must be unique and cannot be else")
        return self


class WorkflowEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    target: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    source_handle: str = Field(default="", max_length=64)
    target_handle: str = Field(default="", max_length=64)


class WorkflowGraph(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    nodes: list[WorkflowNode] = Field(min_length=4, max_length=64)
    edges: list[WorkflowEdge] = Field(min_length=3, max_length=128)

    @model_validator(mode="after")
    def validate_topology(self) -> "WorkflowGraph":
        by_id = {node.id: node for node in self.nodes}
        if len(by_id) != len(self.nodes):
            raise ValueError("workflow graph node ids must be unique")
        starts = [node for node in self.nodes if node.type == "start"]
        contexts = [node for node in self.nodes if node.type == "context"]
        outputs = [node for node in self.nodes if node.type == "output"]
        if len(starts) != 1:
            raise ValueError("workflow graph needs exactly one start node")
        if len(contexts) != 1:
            raise ValueError("workflow graph needs exactly one context node")
        if not any(node.type == "model" for node in self.nodes):
            raise ValueError("workflow graph needs at least one model node")
        if not outputs:
            raise ValueError("workflow graph needs at least one output node")

        adjacency: dict[str, list[str]] = {node_id: [] for node_id in by_id}
        edge_keys: set[tuple[str, str, str, str]] = set()
        condition_handles = {
            node.id: {str(branch["id"]) for branch in node.config["branches"]} | {"else"}
            for node in self.nodes if node.type == "condition"
        }
        used_handles = {node_id: set() for node_id in condition_handles}
        for edge in self.edges:
            if edge.source not in by_id or edge.target not in by_id:
                raise ValueError("workflow graph edges must reference existing nodes")
            if edge.source == edge.target:
                raise ValueError("workflow graph cannot contain self edges")
            key = (edge.source, edge.target, edge.source_handle, edge.target_handle)
            if key in edge_keys:
                raise ValueError("workflow graph cannot contain duplicate edges")
            edge_keys.add(key)
            source = by_id[edge.source]
            target = by_id[edge.target]
            if source.type == "output":
                raise ValueError("output nodes cannot have outgoing edges")
            if target.type == "start":
                raise ValueError("start nodes cannot have incoming edges")
            if source.type == "condition":
                if edge.source_handle not in condition_handles[source.id]:
                    raise ValueError("condition edge uses an unknown branch handle")
                used_handles[source.id].add(edge.source_handle)
            elif edge.source_handle:
                raise ValueError("only condition nodes may use source handles")
            adjacency[edge.source].append(edge.target)
        for node_id, handles in used_handles.items():
            if "else" not in handles:
                raise ValueError(f"condition node {node_id} needs a default else edge")

        visited: set[str] = set()
        active: set[str] = set()
        def visit(node_id: str) -> None:
            if node_id in active:
                raise ValueError("workflow graph must be acyclic")
            if node_id in visited:
                return
            active.add(node_id)
            for child in adjacency[node_id]:
                visit(child)
            active.remove(node_id)
            visited.add(node_id)
        visit(starts[0].id)
        if visited != set(by_id):
            raise ValueError("every workflow graph node must be connected to the start")
        return self

    def assert_publishable(self) -> None:
        for node in self.nodes:
            if node.type == "prompt" and not str(node.config.get("template") or "").strip():
                raise ValueError(f"prompt node {node.id} has no template")
            if node.type == "model":
                if not str(node.config.get("provider_id") or "").strip():
                    raise ValueError(f"model node {node.id} has no provider")
                if not str(node.config.get("model_id") or "").strip():
                    raise ValueError(f"model node {node.id} has no model")


class WorkflowPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    novel_id: int = Field(ge=1)
    purpose: WorkflowPurpose
    is_default: bool = False
    graph: WorkflowGraph

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("workflow name must not be blank")
        return value


class WorkflowUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_default: bool | None = None
    graph: WorkflowGraph | None = None

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("workflow name must not be blank")
        return value
