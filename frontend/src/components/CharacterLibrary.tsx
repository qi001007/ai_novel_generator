import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { api } from "../api";
import type { Character } from "../types";

type CharacterForm = {
  id: number | null;
  name: string;
  level: string;
  portrait: string;
  identity: string;
  goals: string;
  behavior_constraints: string;
  current_status: string;
  expected_start_chapter: number | null;
  expected_end_chapter: number | null;
};

const emptyForm: CharacterForm = {
  id: null,
  name: "",
  level: "supporting",
  portrait: "",
  identity: "",
  goals: "",
  behavior_constraints: "",
  current_status: "",
  expected_start_chapter: null,
  expected_end_chapter: null,
};

const levelTabs = [
  { key: "all", label: "全部" },
  { key: "protagonist", label: "主角团" },
  { key: "supporting", label: "重要配角" },
  { key: "boss", label: "小 Boss" },
  { key: "extra", label: "龙套" },
] as const;

const levelLabels: Record<string, string> = {
  protagonist: "主角团",
  supporting: "重要配角",
  boss: "小 Boss",
  extra: "龙套",
};

function toForm(character: Character): CharacterForm {
  return { ...character };
}

export default function CharacterLibrary({ novelId }: { novelId: number | null }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeLevel, setActiveLevel] = useState<(typeof levelTabs)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CharacterForm | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portraitRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!novelId) {
      setCharacters([]);
      return;
    }
    let active = true;
    api.get<Character[]>(`/api/novels/${novelId}/characters`).then((data) => {
      if (active) setCharacters(data);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });
    return () => {
      active = false;
    };
  }, [novelId]);

  // Dev-only visual-QA link: ?char=<id> opens that card's detail layer, which is
  // otherwise click-only (the portrait control needs a real browser screenshot).
  useEffect(() => {
    if (!import.meta.env.DEV || !characters.length) return;
    const wanted = new URLSearchParams(window.location.search).get("char");
    const found = wanted ? characters.find((item) => String(item.id) === wanted) : null;
    if (found) setEditing(toForm(found));
  }, [characters]);

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setEditing(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return characters.filter((character) => {
      if (activeLevel !== "all" && character.level !== activeLevel) return false;
      if (!keyword) return true;
      return [character.name, character.identity, character.goals]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(keyword));
    });
  }, [characters, activeLevel, query]);

  function pickPortrait(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("照片请控制在 2MB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setEditing((prev) =>
        prev
          ? { ...prev, portrait: typeof reader.result === "string" ? reader.result : prev.portrait }
          : prev,
      );
    reader.onerror = () => setError("读取照片失败，请换一张");
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!novelId || !editing) return;
    setBusy(true);
    setError(null);
    try {
      const { id, ...payload } = editing;
      if (id) {
        await api.put(`/api/novels/${novelId}/characters/${id}`, payload);
      } else {
        await api.post(`/api/novels/${novelId}/characters`, payload);
      }
      const data = await api.get<Character[]>(`/api/novels/${novelId}/characters`);
      setCharacters(data);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!novelId || !editing?.id) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/novels/${novelId}/characters/${editing.id}`);
      const data = await api.get<Character[]>(`/api/novels/${novelId}/characters`);
      setCharacters(data);
      setEditing(null);
      setDeleteArmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="character-library" aria-label="人物卡片库">
      <header className="library-toolbar">
        <div className="level-tabs" role="tablist" aria-label="人物分级">
          {levelTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeLevel === tab.key}
              className={activeLevel === tab.key ? "selected" : ""}
              onClick={() => setActiveLevel(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          className="library-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名 / 身份 / 目标"
          autoComplete="off"
          aria-label="搜索人物"
        />
        <button
          type="button"
          className="primary"
          onClick={() => {
            setDeleteArmed(false);
            setEditing({ ...emptyForm });
          }}
        >
          新建人物
        </button>
      </header>

      {filtered.length === 0 ? (
        <div className="library-empty">
          <h2>{query || activeLevel !== "all" ? "没有匹配的人物" : "还没有人物"}</h2>
          <p>{query || activeLevel !== "all" ? "换个关键词或分级试试。" : "从主角团开始，给故事立起第一张卡。"}</p>
        </div>
      ) : (
        <div className="character-grid">
          {filtered.map((character) => (
            <button
              key={character.id}
              type="button"
              className={`character-card level-${character.level}`}
              onClick={() => {
                setDeleteArmed(false);
                setEditing(toForm(character));
              }}
            >
              <span className="card-head">
                <span className="avatar" aria-hidden="true">
                  {character.portrait ? (
                    <img src={character.portrait} alt="" />
                  ) : (
                    character.name.charAt(0)
                  )}
                </span>
                <span className="card-title">
                  <span className="card-name">{character.name}</span>
                  <span className="card-range tabular">
                    {character.expected_start_chapter || character.expected_end_chapter
                      ? `${character.expected_start_chapter ?? "?"} - ${character.expected_end_chapter ?? "?"} 章`
                      : "常驻"}
                  </span>
                </span>
                <span className="level-badge">{levelLabels[character.level] ?? "未分级"}</span>
              </span>
              <span className="card-identity">{character.identity || "暂无身份设定"}</span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
        >
          <div className="character-modal" role="dialog" aria-modal="true" aria-label="人物详情">
            <header>
              <h2>{editing.id ? "编辑人物" : "新建人物"}</h2>
              <button type="button" className="icon-button" aria-label="关闭" onClick={() => setEditing(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="modal-grid">
              <div className="modal-profile">
                <div className="portrait-field">
                  <span className="avatar large" aria-hidden="true">
                    {editing.portrait ? (
                      <img src={editing.portrait} alt={`${editing.name || "新人物"} 照片`} />
                    ) : (
                      editing.name.charAt(0) || "?"
                    )}
                  </span>
                  <div className="portrait-actions">
                    <button
                      type="button"
                      className="portrait-button"
                      onClick={() => portraitRef.current?.click()}
                    >
                      {editing.portrait ? "更换照片" : "贴照片"}
                    </button>
                    {editing.portrait ? (
                      <button
                        type="button"
                        className="ghost-danger"
                        onClick={() => setEditing({ ...editing, portrait: "" })}
                      >
                        移除
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={portraitRef}
                    type="file"
                    accept="image/*"
                    className="portrait-input"
                    aria-label="上传人物照片"
                    onChange={(event) => {
                      pickPortrait(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <p className="portrait-hint">方形照片效果最好，2MB 以内</p>
                </div>
                <label>
                  姓名
                  <input
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </label>
                <label>
                  分级
                  <select
                    value={editing.level}
                    onChange={(event) => setEditing({ ...editing, level: event.target.value })}
                  >
                    <option value="protagonist">主角团</option>
                    <option value="supporting">重要配角</option>
                    <option value="boss">小 Boss</option>
                    <option value="extra">龙套</option>
                  </select>
                </label>
                <div className="number-pair">
                  <label>
                    起始章
                    <input
                      type="number"
                      value={editing.expected_start_chapter ?? ""}
                      onChange={(event) => setEditing({
                        ...editing,
                        expected_start_chapter: event.target.value ? Number(event.target.value) : null,
                      })}
                    />
                  </label>
                  <label>
                    结束章
                    <input
                      type="number"
                      value={editing.expected_end_chapter ?? ""}
                      onChange={(event) => setEditing({
                        ...editing,
                        expected_end_chapter: event.target.value ? Number(event.target.value) : null,
                      })}
                    />
                  </label>
                </div>
              </div>
              <div className="modal-fields">
                <label>
                  身份
                  <input
                    value={editing.identity}
                    onChange={(event) => setEditing({ ...editing, identity: event.target.value })}
                  />
                </label>
                <label>
                  目标
                  <textarea
                    value={editing.goals}
                    onChange={(event) => setEditing({ ...editing, goals: event.target.value })}
                  />
                </label>
                <label>
                  行为约束
                  <textarea
                    value={editing.behavior_constraints}
                    onChange={(event) => setEditing({ ...editing, behavior_constraints: event.target.value })}
                  />
                </label>
                <label>
                  当前状态
                  <input
                    value={editing.current_status}
                    onChange={(event) => setEditing({ ...editing, current_status: event.target.value })}
                  />
                </label>
              </div>
            </div>
            <footer>
              {editing.id && (
                deleteArmed ? (
                  <div className="delete-confirm">
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      确认删除「{editing.name}」
                    </button>
                    <button type="button" onClick={() => setDeleteArmed(false)}>取消</button>
                  </div>
                ) : (
                  <button type="button" className="ghost-danger" onClick={() => setDeleteArmed(true)}>
                    删除
                  </button>
                )
              )}
              <span className="spacer" />
              <button type="button" onClick={() => setEditing(null)}>取消</button>
              <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
                保存
              </button>
            </footer>
            {error ? <p className="status-error">{error}</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}
