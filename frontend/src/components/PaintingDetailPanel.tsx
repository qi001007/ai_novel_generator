import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";

import { api } from "../api";
import type { MapDetail, MapVersion } from "../types";
import { formatTime } from "../utils/time";
import MapCanvas, { type MapCell, type MapEdge } from "./MapCanvas";
import MapGenerateDialog from "./MapGenerateDialog";
import {
  Button,
  Checkbox,
  FloatingWindow,
  IconButton,
  TextArea,
  TextField,
  useToast,
} from "./ui";

type PaintingDetailPanelProps = {
  onBack?: () => void;
};

type EditAction =
  | { kind: "expand"; edge: MapEdge }
  | { kind: "regenerate"; cell: MapCell };

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  confirmed: "已确认",
  superseded: "已被替代",
};

const EDGE_LABELS: Record<string, string> = {
  east: "向东",
  west: "向西",
  north: "向北",
  south: "向南",
};

function operationLabel(version: MapVersion): string {
  if (version.operation?.kind === "expand") {
    return `扩图 · ${EDGE_LABELS[version.operation.edge ?? ""] ?? version.operation.edge ?? "扩展"}`;
  }
  if (version.operation?.kind === "regenerate" && version.operation.cell) {
    const [x, y] = version.operation.cell;
    return `重绘 · 第 ${x + 1} 列第 ${y + 1} 行`;
  }
  return "整图生成";
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function PaintingDetailPanel({ onBack }: PaintingDetailPanelProps) {
  const params = useParams();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const mapId = Number(params.artworkId);
  const novelId = Number(params.novelId);
  const goBack = onBack ?? (() => navigate(`/novels/${novelId}`));

  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState<"" | "confirm" | "rename" | "delete">("");
  const [generating, setGenerating] = useState(false);
  const [cell, setCell] = useState<MapCell | null>(null);
  const [editAction, setEditAction] = useState<EditAction | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editBilling, setEditBilling] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    let alive = true;
    if (!Number.isFinite(mapId)) {
      setError("地图编号不对");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api
      .get<MapDetail>(`/api/maps/${mapId}`)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        setSelected(data.active_revision ?? data.versions[0]?.revision ?? null);
      })
      .catch((cause) => {
        if (alive) setError(messageOf(cause, "地图加载失败"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mapId]);

  const selectedVersion = useMemo(
    () => detail?.versions.find((version) => version.revision === selected) ?? null,
    [detail, selected],
  );

  useEffect(() => {
    setCell(null);
  }, [selected]);

  const openEdit = (action: EditAction) => {
    setEditAction(action);
    setEditPrompt(action.kind === "regenerate" ? selectedVersion?.prompt ?? "" : "");
    setEditBilling(false);
    setEditError("");
  };

  const submitEdit = async () => {
    if (!detail || !selectedVersion || !editAction) return;
    if (!editPrompt.trim()) {
      setEditError(
        editAction.kind === "expand" ? "请先写一句新区域画什么" : "请先写一句这一格要变成什么样",
      );
      return;
    }
    if (!editBilling) {
      setEditError("扩图会产生费用，请先勾选确认");
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      const base = `/api/maps/${detail.id}`;
      const body =
        editAction.kind === "expand"
          ? {
              parent_revision: selectedVersion.revision,
              edge: editAction.edge,
              prompt: editPrompt.trim(),
              confirm_billing: true,
            }
          : {
              parent_revision: selectedVersion.revision,
              prompt: editPrompt.trim(),
              confirm_billing: true,
            };
      const url =
        editAction.kind === "expand"
          ? `${base}/expand`
          : `${base}/cells/${editAction.cell.x}/${editAction.cell.y}/regenerate`;
      const next = await api.post<MapDetail>(url, body);
      setDetail(next);
      setSelected(next.versions[0]?.revision ?? next.active_revision ?? null);
      setEditAction(null);
      setCell(null);
      pushToast(
        editAction.kind === "expand"
          ? "扩图完成，确认后才会替换当前版本"
          : "这一格已重绘，确认后才会替换当前版本",
        "success",
      );
    } catch (cause) {
      setEditError(messageOf(cause, "扩图失败"));
    } finally {
      setEditBusy(false);
    }
  };

  const confirmSelected = async () => {
    if (!detail || !selectedVersion) return;
    setBusy("confirm");
    try {
      const next = await api.post<MapDetail>(
        `/api/maps/${detail.id}/versions/${selectedVersion.revision}/confirm`,
      );
      setDetail(next);
      setSelected(next.active_revision);
      pushToast(`已把 v${selectedVersion.revision} 设为当前版本`, "success");
    } catch (cause) {
      pushToast(messageOf(cause, "确认版本失败"), "error");
    } finally {
      setBusy("");
    }
  };

  const startRename = () => {
    if (!detail) return;
    setRenameValue(detail.name);
    setRenaming(true);
  };

  const saveName = async () => {
    if (!detail) return;
    const name = renameValue.trim();
    if (!name) {
      pushToast("地图名称不能为空", "error");
      return;
    }
    setBusy("rename");
    try {
      const next = await api.put<MapDetail>(`/api/maps/${detail.id}`, { name });
      setDetail(next);
      setRenaming(false);
      pushToast("地图已重命名", "success");
    } catch (cause) {
      pushToast(messageOf(cause, "重命名失败"), "error");
    } finally {
      setBusy("");
    }
  };

  const removeMap = async () => {
    if (!detail) return;
    if (!window.confirm(`删除《${detail.name}》及其全部版本与图片？`)) return;
    setBusy("delete");
    try {
      await api.del(`/api/maps/${detail.id}`);
      pushToast("地图已删除", "success");
      goBack();
    } catch (cause) {
      pushToast(messageOf(cause, "删除失败"), "error");
      setBusy("");
    }
  };

  if (loading) {
    return (
      <section className="page-panel painting-detail" aria-label="地图详情">
        <p className="painting-placeholder">正在读取地图…</p>
      </section>
    );
  }

  if (error || !detail) {
    return (
      <section className="page-panel painting-detail" aria-label="地图详情">
        <header className="painting-header">
          <IconButton type="button" aria-label="返回地图列表" onClick={goBack}>
            <ChevronLeft size={16} />
          </IconButton>
          <h2>地图详情</h2>
        </header>
        <div className="page-panel-empty">
          <h3>这张地图打不开</h3>
          <p role="alert">{error || "地图不存在"}</p>
          <Button onClick={goBack}>返回地图列表</Button>
        </div>
      </section>
    );
  }

  const isConfirmed = selectedVersion
    ? selectedVersion.revision === detail.active_revision
    : false;

  return (
    <section className="page-panel painting-detail" aria-label="地图详情">
      <header className="painting-header">
        <IconButton type="button" aria-label="返回地图列表" onClick={goBack}>
          <ChevronLeft size={16} />
        </IconButton>
        <h2>
          {detail.name}
          {selectedVersion ? ` · v${selectedVersion.revision}` : ""}
        </h2>
        <div className="painting-header-actions">
          {selectedVersion ? (
            <a
              className="painting-download"
              href={`${selectedVersion.image_url}?download=1`}
              download
            >
              <Download size={14} />
              下载
            </a>
          ) : null}
          <Button onClick={startRename}>
            <Pencil size={14} />
            重命名
          </Button>
          <Button tone="danger" onClick={removeMap} loading={busy === "delete"}>
            <Trash2 size={14} />
            删除地图
          </Button>
        </div>
      </header>

      <div className="painting-body">
        {selectedVersion ? (
          <MapCanvas
            name={detail.name}
            version={selectedVersion}
            selectedCell={cell}
            onSelectCell={setCell}
            onExpand={(edge) => openEdit({ kind: "expand", edge })}
            disabled={busy !== "" || editBusy}
          />
        ) : (
          <div className="painting-canvas">
            <p className="painting-placeholder">还没有生成任何版本</p>
          </div>
        )}

        <aside className="painting-sidebar">
          {selectedVersion ? (
            <section aria-label="当前版本">
              <h3>版本 v{selectedVersion.revision}</h3>
              <p className="painting-status">
                {isConfirmed ? (
                  <span className="map-status is-confirmed">
                    <CheckCircle2 size={12} /> 当前确认版本
                  </span>
                ) : (
                  <span className={`map-status is-${selectedVersion.status}`}>
                    {STATUS_LABEL[selectedVersion.status] ?? selectedVersion.status}
                  </span>
                )}
              </p>
              <dl className="painting-costs">
                <dt>模型</dt>
                <dd>{selectedVersion.model || "—"}</dd>
                <dt>尺寸</dt>
                <dd className="tabular">{selectedVersion.size || "—"}</dd>
                <dt>来源</dt>
                <dd>{operationLabel(selectedVersion)}</dd>
                {selectedVersion.parent_revision ? (
                  <>
                    <dt>基于</dt>
                    <dd className="tabular">v{selectedVersion.parent_revision}</dd>
                  </>
                ) : null}
                <dt>生成时间</dt>
                <dd className="tabular">{formatTime(selectedVersion.created_at)}</dd>
                <dt>请求编号</dt>
                <dd className="tabular">{selectedVersion.request_id || "—"}</dd>
              </dl>
              {!isConfirmed ? (
                <Button
                  tone="primary"
                  onClick={confirmSelected}
                  loading={busy === "confirm"}
                >
                  确认此版本
                </Button>
              ) : null}
            </section>
          ) : null}

          {selectedVersion && (selectedVersion.cols ?? 0) > 0 && (selectedVersion.rows ?? 0) > 0 ? (
            <section aria-label="分块操作" className="map-grid-panel">
              <h3>分块</h3>
              <p className="prefs-muted">
                {selectedVersion.cols} × {selectedVersion.rows} 格 · 每格{" "}
                {selectedVersion.cell || 1024} px
              </p>
              {cell ? (
                <>
                  <p className="map-grid-selection">
                    已选第 {cell.x + 1} 列第 {cell.y + 1} 行
                  </p>
                  <Button onClick={() => openEdit({ kind: "regenerate", cell })} disabled={editBusy}>
                    重绘这一格
                  </Button>
                </>
              ) : (
                <p className="prefs-muted">点画布上的格子，选择要重绘的一格</p>
              )}
            </section>
          ) : null}

          <h3>
            <Clock size={14} aria-hidden="true" />
            生成历史
          </h3>
          <ol className="painting-history">
            {detail.versions.map((version: MapVersion) => (
              <li key={version.revision}>
                <button
                  type="button"
                  className={`painting-history-item ${version.revision === selected ? "selected" : ""}`}
                  onClick={() => setSelected(version.revision)}
                >
                  <span className="painting-history-text">
                    <span>
                      v{version.revision} · {STATUS_LABEL[version.status] ?? version.status}
                    </span>
                    <small>{operationLabel(version)}</small>
                  </span>
                  <time>{formatTime(version.created_at)}</time>
                </button>
              </li>
            ))}
          </ol>

          <h3>提示词</h3>
          <div className="painting-prompt">
            {selectedVersion?.prompt || "—"}
          </div>

          <Button tone="primary" onClick={() => setGenerating(true)}>
            <Sparkles size={14} />
            生成新版本
          </Button>
        </aside>
      </div>

      {renaming ? (
        <FloatingWindow
          title="重命名地图"
          onClose={() => setRenaming(false)}
          width={380}
          height={180}
          fitContent
        >
          <div className="map-rename">
            <TextField
              aria-label="地图名称"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={80}
              autoFocus
            />
            <footer>
              <Button onClick={() => setRenaming(false)}>取消</Button>
              <Button
                tone="primary"
                onClick={saveName}
                loading={busy === "rename"}
              >
                保存名称
              </Button>
            </footer>
          </div>
        </FloatingWindow>
      ) : null}

      {editAction ? (
        <FloatingWindow
          title={
            editAction.kind === "expand"
              ? `扩图 · ${EDGE_LABELS[editAction.edge] ?? editAction.edge}`
              : `重绘 · 第 ${editAction.cell.x + 1} 列第 ${editAction.cell.y + 1} 行`
          }
          onClose={() => {
            if (!editBusy) setEditAction(null);
          }}
          width={Math.min(540, Math.max(320, window.innerWidth - 32))}
          fitContent
        >
          <div className="map-edit">
            <p className="prefs-muted">
              只重绘白色遮罩区；遮罩外的像素会按父版本逐像素贴回，不羽化、不缩放。
            </p>
            <label className="map-generate-field">
              <span>
                {editAction.kind === "expand" ? "新区域画什么" : "这一格要变成什么样"}
              </span>
              <TextArea
                aria-label="扩图提示词"
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                rows={5}
                placeholder={
                  editAction.kind === "expand"
                    ? "例如：海岸向东延伸出礁石与灯塔，道路接到新城门"
                    : "例如：这一格改成雪山隘口，道路从西侧穿过"
                }
              />
            </label>
            <div className="map-generate-billing">
              <Checkbox checked={editBilling} onChange={setEditBilling}>
                确认会产生费用
              </Checkbox>
              <small>
                本次只发送 1 次付费扩图请求，约 ¥0.14（以供应商账单为准）；失败不会自动重发。
              </small>
            </div>
            {editError ? (
              <p className="map-generate-error" role="alert">
                {editError}
              </p>
            ) : null}
            <footer className="map-generate-actions">
              <Button onClick={() => setEditAction(null)} disabled={editBusy}>
                取消
              </Button>
              <Button tone="primary" onClick={submitEdit} loading={editBusy}>
                {editAction.kind === "expand" ? "确认扩图" : "确认重绘"}
              </Button>
            </footer>
          </div>
        </FloatingWindow>
      ) : null}

      {generating ? (
        <MapGenerateDialog
          novelId={detail.novel_id}
          project={detail}
          onClose={() => setGenerating(false)}
          onDone={(next) => {
            setGenerating(false);
            setDetail(next);
            // Jump to the revision just generated; the confirmed one stays active until
            // the author promotes this draft, so it must not win the selection here.
            setSelected(next.versions[0]?.revision ?? next.active_revision ?? null);
            pushToast("新版本已生成，确认后才会替换当前版本", "success");
          }}
        />
      ) : null}
    </section>
  );
}
