import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { useFiles } from "../store/files";
import type { Character, FileDoc, FileWriteResult } from "../types";
import CharacterFormCard from "./CharacterFormCard";
import type { CharacterForm, LongFieldKey } from "./CharacterFormCard";
import {
  characterDocPath,
  emptyForm,
  fillCharacterDoc,
  LEVEL_LABELS,
  NEW_CHARACTER_PATH,
} from "./CharacterFormCard";

const levelTabs = [
  { key: "all", label: "全部" },
  { key: "protagonist", label: "主角团" },
  { key: "supporting", label: "重要配角" },
  { key: "boss", label: "小 Boss" },
  { key: "extra", label: "龙套" },
] as const;

function toForm(character: Character): CharacterForm {
  return { ...emptyForm, ...character };
}

export default function CharacterLibrary({ novelId }: { novelId: number | null }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeLevel, setActiveLevel] = useState<(typeof levelTabs)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CharacterForm | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          <p>{query || activeLevel !== "all" ? "换个关键词或分级试试" : "从主角团开始，给故事立起第一张卡"}</p>
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
          {/* 第十六批批注 7: the card itself is no longer written here - the file pane
              shows the same one, so the two cannot drift apart. */}
          <CharacterFormCard
            value={editing}
            onChange={setEditing}
            onSave={() => void save()}
            onCancel={() => setEditing(null)}
            onPickPortrait={pickPortrait}
            onRemovePortrait={() => setEditing({ ...editing, portrait: "" })}
            onEditLongField={editInFile}
            busy={busy}
            error={error}
            title={editing.id ? "编辑人物" : "新建人物"}
            onClose={() => setEditing(null)}
            extra={
              editing.id ? (
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
              ) : null
            }
          />
        </div>
      )}
    </section>
  );
}
