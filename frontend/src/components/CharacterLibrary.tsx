import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";

import { api } from "../api";
import { useFiles } from "../store/files";
import type { Character, FileDoc, FileWriteResult } from "../types";

/** The one path a character document lives at (DECISIONS D-15). */
const NEW_CHARACTER_PATH = "settings/characters/new.md";
const characterDocPath = (id: number | null) =>
  id === null ? NEW_CHARACTER_PATH : `settings/characters/${id}.md`;

/** Frame 26: the long fields are prose, so the modal only previews them. */
type LongFieldKey = "identity" | "goals" | "behavior_constraints" | "current_status";
const LONG_FIELDS: { key: LongFieldKey; label: string }[] = [
  { key: "identity", label: "身份" },
  { key: "goals", label: "目标" },
  { key: "behavior_constraints", label: "行为约束" },
  { key: "current_status", label: "当前状态" },
];

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

/* Shared with the document's rendered view, so one level never reads two ways. */
export const LEVEL_LABELS: Record<string, string> = {
  protagonist: "主角团",
  supporting: "重要配角",
  boss: "小 Boss",
  extra: "龙套",
};

function toForm(character: Character): CharacterForm {
  return { ...character };
}

/* The character document is the projection the server renders, so the form edits that
   text in place instead of re-deriving a second format here. Anything the writer does
   not recognise comes back as a structure error, which is the point. */
function setBullet(text: string, label: string, value: string): string {
  const re = new RegExp("^- \\*\\*" + label + "\\*\\*：[^\\n]*", "m");
  return re.test(text) ? text.replace(re, "- **" + label + "**：" + value) : text;
}


function fillCharacterDoc(text: string, form: CharacterForm): string {
  let out = text;
  out = setBullet(out, "姓名", form.name.trim());
  out = setBullet(out, "分级", form.level);
  out = setBullet(out, "起始章", form.expected_start_chapter === null ? "—" : String(form.expected_start_chapter));
  out = setBullet(out, "结束章", form.expected_end_chapter === null ? "—" : String(form.expected_end_chapter));
  // The four sections are deliberately not written from here: the modal opens with a
  // snapshot, and a snapshot saved after someone edited the file would overwrite
  // their work with stale text. Long fields belong to the editor now (帧 26).
  return out;
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
  const openFile = useFiles((state) => state.open);

  // Hand the caret to FileEditorPane at the matching section. revealSeq is bumped
  // by open(), and WorkbenchPage turns that into "files" on its own.
  function editInFile(field: LongFieldKey) {
    if (!editing?.id) return;
    void openFile(characterDocPath(editing.id), { field });
  }

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
      const { id, portrait } = editing;
      // One writer for content: the file layer. A create lands on new.md and the
      // result reports the numeric path it was moved to, which is how the id is found.
      const docPath = characterDocPath(id);
      const doc = await api.get<FileDoc>(`/api/novels/${novelId}/files/${docPath}`);
      const written = await api.put<FileWriteResult>(`/api/novels/${novelId}/files/${docPath}`, {
        text: fillCharacterDoc(doc.text, editing),
        actor: "human",
        base_revision: doc.revision,
      });
      const savedId = id ?? Number(/(\d+)\.md$/.exec(written.path)?.[1]);
      // A portrait is a base64 asset, not prose: it has its own narrow endpoint so the
      // document layer stays the only writer of text fields (DECISIONS D-15).
      const original = id ? characters.find((item) => item.id === id)?.portrait ?? "" : "";
      if (savedId && portrait !== original) {
        await api.put(`/api/novels/${novelId}/characters/${savedId}/portrait`, { portrait });
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
        {/* 批注 19 要跳转入口放在「新建人物」旁。写 new.md 即建档：服务端把路径换成
            数字 id，卡片库与文件层共用同一条写通路（D-15）。 */}
        <button type="button" onClick={() => void openFile(NEW_CHARACTER_PATH)}>
          在文件中新建
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
                <span className="level-badge">{LEVEL_LABELS[character.level] ?? "未分级"}</span>
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
                <p className="long-field-hint">以下为长字段：弹窗内只读预览，编辑回文件层</p>
                {LONG_FIELDS.map((item) => {
                  const value = editing[item.key];
                  return (
                    <div className="long-field" key={item.key}>
                      <span className="long-field-label">{item.label}</span>
                      <div className="long-field-box">
                        <p className={value ? "long-field-text" : "long-field-text blank"}>{value || "—"}</p>
                        <button
                          type="button"
                          className="long-field-edit"
                          aria-label={`在文件中编辑${item.label}`}
                          title={
                            editing.id
                              ? `在右栏打开 ${editing.id}.md 并定位到「${item.label}」`
                              : "先保存人物，再在文件中编辑"
                          }
                          disabled={!editing.id}
                          onClick={() => editInFile(item.key)}
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
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
