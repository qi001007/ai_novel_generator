import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { api } from "../api";
import type { ArcPlan, ChapterBrief, MapDetail, MapVersion } from "../types";
import { Button, Checkbox, FloatingWindow, TextArea, TextField } from "./ui";

type MapGenerateDialogProps = {
  novelId: number;
  /** Present when this window generates a new revision instead of a new map. */
  project?: MapDetail;
  onClose: () => void;
  onDone: (detail: MapDetail) => void;
};

const SIZES = [
  { value: "1024x1536", label: "竖幅 1024 × 1536" },
  { value: "1536x1024", label: "横幅 1536 × 1024" },
  { value: "1024x1024", label: "方形 1024 × 1024" },
  { value: "2048x2048", label: "2K 方形 2048 × 2048" },
];

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function MapGenerateDialog({ novelId, project, onClose, onDone }: MapGenerateDialogProps) {
  const [name, setName] = useState("");
  const [arcs, setArcs] = useState<ArcPlan[]>([]);
  const [briefs, setBriefs] = useState<ChapterBrief[]>([]);
  const [arcId, setArcId] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const initialPrompt = project?.versions[0]?.prompt ?? "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [promptLoading, setPromptLoading] = useState(false);
  const [size, setSize] = useState("1024x1536");
  const [billing, setBilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdProject, setCreatedProject] = useState<MapDetail | null>(null);
  const lastSelection = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<ArcPlan[]>(`/api/novels/${novelId}/planning/arcs`),
      api.get<ChapterBrief[]>(`/api/novels/${novelId}/planning/briefs`),
    ])
      .then(([arcRows, briefRows]) => {
        if (!alive) return;
        setArcs(arcRows);
        setBriefs(briefRows);
      })
      .catch((cause) => {
        if (alive) setError(messageOf(cause, "剧情资料加载失败"));
      });
    return () => {
      alive = false;
    };
  }, [novelId]);

  useEffect(() => {
    const selection = `${arcId}:${chapterNumber}`;
    // Version mode keeps the previous prompt: mark it loaded before the first fetch.
    if (initialPrompt && lastSelection.current === null) {
      lastSelection.current = selection;
      return;
    }
    // Only a landed response counts as loaded. Marking it before the request would let
    // StrictMode's discarded first run leave the prompt empty forever.
    if (lastSelection.current === selection) return;
    let alive = true;
    const query = new URLSearchParams();
    if (arcId) query.set("arc_id", arcId);
    if (chapterNumber) query.set("chapter_number", chapterNumber);
    const suffix = query.toString();
    setPromptLoading(true);
    api
      .get<{ prompt: string }>(
        `/api/novels/${novelId}/maps/prompt${suffix ? `?${suffix}` : ""}`,
      )
      .then((data) => {
        if (!alive) return;
        lastSelection.current = selection;
        setPrompt(data.prompt);
      })
      .catch((cause) => {
        if (alive) setError(messageOf(cause, "提示词加载失败"));
      })
      .finally(() => {
        if (alive) setPromptLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [novelId, arcId, chapterNumber, initialPrompt]);

  const visibleBriefs = useMemo(
    () =>
      arcId
        ? briefs.filter((brief) => String(brief.arc_plan_id) === arcId)
        : briefs,
    [briefs, arcId],
  );

  const pickArc = (value: string) => {
    setArcId(value);
    if (value && chapterNumber) {
      const stillThere = briefs.some(
        (brief) =>
          String(brief.chapter_number) === chapterNumber &&
          String(brief.arc_plan_id) === value,
      );
      if (!stillThere) setChapterNumber("");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!project && !name.trim()) {
      setError("请先给地图起个名字");
      return;
    }
    if (!prompt.trim()) {
      setError("生图提示词不能为空");
      return;
    }
    if (!billing) {
      setError("生图会产生费用，请先勾选确认");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      let target = project ?? createdProject;
      if (!target) {
        target = await api.post<MapDetail>(`/api/novels/${novelId}/maps`, {
          name: name.trim(),
        });
        setCreatedProject(target);
      }
      await api.post<MapVersion>(`/api/maps/${target.id}/versions`, {
        prompt: prompt.trim(),
        confirm_billing: true,
        size,
      });
      const detail = await api.get<MapDetail>(`/api/maps/${target.id}`);
      onDone(detail);
    } catch (cause) {
      setError(messageOf(cause, "地图生成失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingWindow
      title={project ? "生成新版本" : "生成世界观地图"}
      onClose={onClose}
      width={Math.min(720, Math.max(320, window.innerWidth - 32))}
      height={Math.min(680, Math.max(360, window.innerHeight - 48))}
    >
      <form className="map-generate" onSubmit={submit}>
        {project ? null : (
          <label className="map-generate-field">
            <span>地图名称</span>
            <TextField
              aria-label="地图名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：雾城全域图"
              maxLength={80}
            />
          </label>
        )}

        <div className="map-generate-sources">
          <label className="map-generate-field">
            <span>剧情弧</span>
            <select
              aria-label="剧情弧"
              value={arcId}
              onChange={(event) => pickArc(event.target.value)}
            >
              <option value="">不指定</option>
              {arcs.map((arc) => (
                <option key={arc.id} value={String(arc.id)}>
                  第 {arc.start_chapter}-{arc.end_chapter} 章 · {arc.title || "未命名剧情弧"}
                </option>
              ))}
            </select>
          </label>
          <label className="map-generate-field">
            <span>章节简报</span>
            <select
              aria-label="章节简报"
              value={chapterNumber}
              onChange={(event) => setChapterNumber(event.target.value)}
            >
              <option value="">不指定</option>
              {visibleBriefs.map((brief) => (
                <option key={brief.id} value={String(brief.chapter_number)}>
                  第 {brief.chapter_number} 章{brief.goal ? ` · ${brief.goal.slice(0, 24)}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="map-generate-field map-generate-prompt">
          <span>
            生图提示词
            {promptLoading ? <small>正在按主线和剧情资料拼装…</small> : null}
          </span>
          <TextArea
            aria-label="生图提示词"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={12}
          />
        </label>

        <label className="map-generate-field">
          <span>图片尺寸</span>
          <select aria-label="图片尺寸" value={size} onChange={(event) => setSize(event.target.value)}>
            {SIZES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <div className="map-generate-billing">
          <Checkbox checked={billing} onChange={setBilling}>确认会产生费用</Checkbox>
          <small>单张图片按所选模型计费；不勾选不会调用供应商</small>
        </div>

        {error ? <p className="map-generate-error" role="alert">{error}</p> : null}

        <footer className="map-generate-actions">
          <Button type="button" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" tone="primary" loading={busy}>
            <Sparkles size={14} />
            {project ? "生成新版本" : "创建并生成"}
          </Button>
        </footer>
      </form>
    </FloatingWindow>
  );
}
