import { useEffect, useState } from "react";

import { api } from "../api";
import type { ArcPlan, ChapterBrief, PlanningBlueprint, TocEntry } from "../types";

type Layer = "A" | "B" | "C" | "D";

type BlueprintForm = {
  id: number | null;
  version: number;
  is_active: boolean;
  main_line: string;
  ending: string;
  core_conflicts: string;
  themes: string;
  constraints: string;
};

type TocForm = {
  id: number | null;
  chapter_number: number;
  title: string;
  plot_function: string;
  notes: string;
  is_active: boolean;
};

type ArcForm = {
  id: number | null;
  title: string;
  start_chapter: number;
  end_chapter: number;
  objective: string;
  conflict: string;
  resolution: string;
  status: string;
  planned_chapters: string;
};

type BriefForm = {
  id: number | null;
  chapter_number: number;
  arc_plan_id: number | null;
  goal: string;
  events: string;
  pov: string;
  characters: string;
  conflict: string;
  hook: string;
  required_facts: string;
  status: string;
};

const emptyBlueprint: BlueprintForm = {
  id: null,
  version: 1,
  is_active: true,
  main_line: "",
  ending: "",
  core_conflicts: "",
  themes: "",
  constraints: "",
};

const emptyToc: TocForm = {
  id: null,
  chapter_number: 1,
  title: "",
  plot_function: "",
  notes: "",
  is_active: true,
};

const emptyArc: ArcForm = {
  id: null,
  title: "",
  start_chapter: 1,
  end_chapter: 10,
  objective: "",
  conflict: "",
  resolution: "",
  status: "planned",
  planned_chapters: "{}",
};

const emptyBrief: BriefForm = {
  id: null,
  chapter_number: 1,
  arc_plan_id: null,
  goal: "",
  events: "",
  pov: "",
  characters: "",
  conflict: "",
  hook: "",
  required_facts: "",
  status: "draft",
};

const layerLabels: Record<Layer, string> = {
  A: "A 全书蓝图",
  B: "B 目录规划",
  C: "C 剧情弧窗口",
  D: "D 单章简报",
};

export default function PlanningPanel({
  novelId,
  initialLayer,
}: {
  novelId: number | null;
  initialLayer?: "A" | "B" | "C" | "D";
}) {
  const [layer, setLayer] = useState<Layer>(initialLayer ?? "A");

  useEffect(() => {
    if (initialLayer) setLayer(initialLayer);
  }, [initialLayer]);
  const [blueprints, setBlueprints] = useState<PlanningBlueprint[]>([]);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [arcs, setArcs] = useState<ArcPlan[]>([]);
  const [briefs, setBriefs] = useState<ChapterBrief[]>([]);
  const [blueprintForm, setBlueprintForm] = useState<BlueprintForm>(emptyBlueprint);
  const [tocForm, setTocForm] = useState<TocForm>(emptyToc);
  const [arcForm, setArcForm] = useState<ArcForm>(emptyArc);
  const [briefForm, setBriefForm] = useState<BriefForm>(emptyBrief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!novelId) return;

    let active = true;
    Promise.all([
      api.get<PlanningBlueprint[]>(`/api/novels/${novelId}/planning/blueprints`),
      api.get<TocEntry[]>(`/api/novels/${novelId}/planning/toc`),
      api.get<ArcPlan[]>(`/api/novels/${novelId}/planning/arcs`),
      api.get<ChapterBrief[]>(`/api/novels/${novelId}/planning/briefs`),
    ]).then(([blueprintData, tocData, arcData, briefData]) => {
      if (!active) return;
      setBlueprints(blueprintData);
      setToc(tocData);
      setArcs(arcData);
      setBriefs(briefData);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [novelId]);

  function splitList(value: string) {
    return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }

  async function reload(novelId: number) {
    const [blueprintData, tocData, arcData, briefData] = await Promise.all([
      api.get<PlanningBlueprint[]>(`/api/novels/${novelId}/planning/blueprints`),
      api.get<TocEntry[]>(`/api/novels/${novelId}/planning/toc`),
      api.get<ArcPlan[]>(`/api/novels/${novelId}/planning/arcs`),
      api.get<ChapterBrief[]>(`/api/novels/${novelId}/planning/briefs`),
    ]);
    setBlueprints(blueprintData);
    setToc(tocData);
    setArcs(arcData);
    setBriefs(briefData);
  }

  async function saveBlueprint() {
    if (!novelId) return;
    const payload = {
      version: blueprintForm.version,
      is_active: blueprintForm.is_active,
      main_line: blueprintForm.main_line,
      ending: blueprintForm.ending,
      core_conflicts: blueprintForm.core_conflicts,
      themes: blueprintForm.themes,
      constraints: blueprintForm.constraints,
    };
    if (blueprintForm.id) {
      await api.put(`/api/novels/${novelId}/planning/blueprints/${blueprintForm.id}`, payload);
    } else {
      await api.post(`/api/novels/${novelId}/planning/blueprints`, payload);
    }
    await reload(novelId);
    setBlueprintForm(emptyBlueprint);
  }

  async function saveToc() {
    if (!novelId) return;
    const payload = {
      chapter_number: tocForm.chapter_number,
      title: tocForm.title,
      plot_function: tocForm.plot_function,
      notes: tocForm.notes,
      is_active: tocForm.is_active,
    };
    if (tocForm.id) {
      await api.put(`/api/novels/${novelId}/planning/toc/${tocForm.id}`, payload);
    } else {
      await api.post(`/api/novels/${novelId}/planning/toc`, payload);
    }
    await reload(novelId);
    setTocForm(emptyToc);
  }

  async function saveArc() {
    if (!novelId) return;
    const payload = {
      title: arcForm.title,
      start_chapter: arcForm.start_chapter,
      end_chapter: arcForm.end_chapter,
      objective: arcForm.objective,
      conflict: arcForm.conflict,
      resolution: arcForm.resolution,
      status: arcForm.status,
      planned_chapters: JSON.parse(arcForm.planned_chapters || "{}"),
    };
    if (arcForm.id) {
      await api.put(`/api/novels/${novelId}/planning/arcs/${arcForm.id}`, payload);
    } else {
      await api.post(`/api/novels/${novelId}/planning/arcs`, payload);
    }
    await reload(novelId);
    setArcForm(emptyArc);
  }

  async function saveBrief() {
    if (!novelId) return;
    const payload = {
      arc_plan_id: briefForm.arc_plan_id,
      chapter_number: briefForm.chapter_number,
      goal: briefForm.goal,
      events: briefForm.events,
      pov: briefForm.pov,
      characters: splitList(briefForm.characters),
      conflict: briefForm.conflict,
      hook: briefForm.hook,
      required_facts: splitList(briefForm.required_facts),
      status: briefForm.status,
    };
    if (briefForm.id) {
      await api.put(`/api/novels/${novelId}/planning/briefs/${briefForm.id}`, payload);
    } else {
      await api.post(`/api/novels/${novelId}/planning/briefs`, payload);
    }
    await reload(novelId);
    setBriefForm(emptyBrief);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (layer === "A") await saveBlueprint();
      if (layer === "B") await saveToc();
      if (layer === "C") await saveArc();
      if (layer === "D") await saveBrief();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel planning-panel">
      <h2>四层规划</h2>
      <div className="segmented">
        {(Object.keys(layerLabels) as Layer[]).map((key) => (
          <button
            key={key}
            type="button"
            className={layer === key ? "selected" : ""}
            onClick={() => setLayer(key)}
          >
            {layerLabels[key]}
          </button>
        ))}
      </div>

      {layer === "A" ? (
        <>
          <div className="version-chips">
            {blueprints.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip ${blueprintForm.id === item.id ? "selected" : ""}`}
                onClick={() => setBlueprintForm({...item})}
              >
                v{item.version}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setBlueprintForm(emptyBlueprint)}>
              新版本
            </button>
          </div>
          <div className="doc-editor">
            <label className="doc-section">
              <h3>主线</h3>
              <textarea
                value={blueprintForm.main_line}
                onChange={(event) => setBlueprintForm({...blueprintForm, main_line: event.target.value})}
                placeholder="整条故事的主线走向…"
              />
            </label>
            <label className="doc-section">
              <h3>终局</h3>
              <textarea
                value={blueprintForm.ending}
                onChange={(event) => setBlueprintForm({...blueprintForm, ending: event.target.value})}
                placeholder="全书结局…"
              />
            </label>
            <label className="doc-section">
              <h3>核心冲突</h3>
              <textarea
                value={blueprintForm.core_conflicts}
                onChange={(event) => setBlueprintForm({...blueprintForm, core_conflicts: event.target.value})}
                placeholder="推动全书的核心矛盾…"
              />
            </label>
            <label className="doc-section">
              <h3>主题</h3>
              <textarea
                value={blueprintForm.themes}
                onChange={(event) => setBlueprintForm({...blueprintForm, themes: event.target.value})}
                placeholder="想表达的主题…"
              />
            </label>
            <label className="doc-section">
              <h3>约束</h3>
              <textarea
                value={blueprintForm.constraints}
                onChange={(event) => setBlueprintForm({...blueprintForm, constraints: event.target.value})}
                placeholder="力量体系、禁忌、世界规则…"
              />
            </label>
          </div>
        </>
      ) : null}

      {layer === "B" ? (
        <>
          <ul className="toc-tree" aria-label="目录树">
            {toc.map((item) => (
              <li key={item.id} className={tocForm.id === item.id ? "open" : ""}>
                <button
                  type="button"
                  className="toc-row"
                  onClick={() => setTocForm({...item})}
                >
                  <span className="toc-number tabular">{item.chapter_number}</span>
                  <input
                    value={item.title}
                    aria-label={`第 ${item.chapter_number} 章名`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const title = event.target.value;
                      setToc((prev) => prev.map((row) => (row.id === item.id ? {...row, title} : row)));
                    }}
                    onBlur={() => {
                      if (!novelId || item.title === toc.find((row) => row.id === item.id)?.title) return;
                      void api.put(`/api/novels/${novelId}/planning/toc/${item.id}`, {
                        chapter_number: item.chapter_number,
                        title: item.title,
                        plot_function: item.plot_function,
                        notes: item.notes,
                        is_active: item.is_active,
                      }).then(() => {
                        if (novelId) return reload(novelId);
                      }).catch(() => undefined);
                    }}
                  />
                </button>
              </li>
            ))}
          </ul>
          <div className="toc-detail-head">
            {tocForm.id ? (
              <span>第 {tocForm.chapter_number} 章 · 详情</span>
            ) : (
              <span>点上方章节查看详情，或直接新增</span>
            )}
          </div>
          <div className="form-grid">
            <input
              type="number"
              value={tocForm.chapter_number}
              onChange={(event) => setTocForm({...tocForm, chapter_number: Number(event.target.value)})}
              placeholder="章号"
            />
            <input
              value={tocForm.title}
              onChange={(event) => setTocForm({...tocForm, title: event.target.value})}
              placeholder="章节名"
            />
            <input
              value={tocForm.plot_function}
              onChange={(event) => setTocForm({...tocForm, plot_function: event.target.value})}
              placeholder="剧情功能"
            />
            <textarea
              value={tocForm.notes}
              onChange={(event) => setTocForm({...tocForm, notes: event.target.value})}
              placeholder="备注"
            />
          </div>
        </>
      ) : null}

      {layer === "C" ? (
        <>
          <ul className="item-list">
            {arcs.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setArcForm({
                  ...item,
                  planned_chapters: JSON.stringify(item.planned_chapters, null, 2),
                })}>
                  {item.title || "未命名"}（{item.start_chapter}-{item.end_chapter}）
                </button>
              </li>
            ))}
          </ul>
          <div className="form-grid">
            <input
              value={arcForm.title}
              onChange={(event) => setArcForm({...arcForm, title: event.target.value})}
              placeholder="剧情弧名"
            />
            <div className="number-pair">
              <input
                type="number"
                value={arcForm.start_chapter}
                onChange={(event) => setArcForm({...arcForm, start_chapter: Number(event.target.value)})}
                placeholder="起始章"
              />
              <input
                type="number"
                value={arcForm.end_chapter}
                onChange={(event) => setArcForm({...arcForm, end_chapter: Number(event.target.value)})}
                placeholder="结束章"
              />
            </div>
            <textarea
              value={arcForm.objective}
              onChange={(event) => setArcForm({...arcForm, objective: event.target.value})}
              placeholder="目标"
            />
            <textarea
              value={arcForm.conflict}
              onChange={(event) => setArcForm({...arcForm, conflict: event.target.value})}
              placeholder="冲突"
            />
            <textarea
              value={arcForm.resolution}
              onChange={(event) => setArcForm({...arcForm, resolution: event.target.value})}
              placeholder="结果"
            />
            <textarea
              value={arcForm.planned_chapters}
              onChange={(event) => setArcForm({...arcForm, planned_chapters: event.target.value})}
              placeholder="planned_chapters JSON"
            />
          </div>
        </>
      ) : null}

      {layer === "D" ? (
        <>
          <ul className="item-list">
            {briefs.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setBriefForm({
                  ...item,
                  characters: item.characters.join("，"),
                  required_facts: item.required_facts.join("，"),
                })}>
                  第 {item.chapter_number} 章 {item.goal || "未命名"}
                </button>
              </li>
            ))}
          </ul>
          <div className="form-grid">
            <input
              type="number"
              value={briefForm.chapter_number}
              onChange={(event) => setBriefForm({...briefForm, chapter_number: Number(event.target.value)})}
              placeholder="章号"
            />
            <select
              value={briefForm.arc_plan_id ?? ""}
              onChange={(event) => setBriefForm({
                ...briefForm,
                arc_plan_id: event.target.value ? Number(event.target.value) : null,
              })}
            >
              <option value="">未关联剧情弧</option>
              {arcs.map((arc) => (
                <option key={arc.id} value={arc.id}>{arc.title || "未命名"}</option>
              ))}
            </select>
            <input
              value={briefForm.goal}
              onChange={(event) => setBriefForm({...briefForm, goal: event.target.value})}
              placeholder="本章目标"
            />
            <textarea
              value={briefForm.events}
              onChange={(event) => setBriefForm({...briefForm, events: event.target.value})}
              placeholder="事件"
            />
            <input
              value={briefForm.pov}
              onChange={(event) => setBriefForm({...briefForm, pov: event.target.value})}
              placeholder="视角"
            />
            <input
              value={briefForm.characters}
              onChange={(event) => setBriefForm({...briefForm, characters: event.target.value})}
              placeholder="人物，逗号分隔"
            />
            <textarea
              value={briefForm.conflict}
              onChange={(event) => setBriefForm({...briefForm, conflict: event.target.value})}
              placeholder="冲突"
            />
            <textarea
              value={briefForm.hook}
              onChange={(event) => setBriefForm({...briefForm, hook: event.target.value})}
              placeholder="钩子"
            />
            <input
              value={briefForm.required_facts}
              onChange={(event) => setBriefForm({...briefForm, required_facts: event.target.value})}
              placeholder="必要事实，逗号分隔"
            />
          </div>
        </>
      ) : null}

      <div className="toolbar">
        <button type="button" className="primary" disabled={busy || !novelId} onClick={() => save()}>
          保存当前层
        </button>
      </div>
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
