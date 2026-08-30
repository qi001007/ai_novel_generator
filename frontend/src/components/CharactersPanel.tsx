import { useEffect, useState } from "react";

import { api } from "../api";
import type { Character } from "../types";

type CharacterForm = {
  name: string;
  level: string;
  identity: string;
  goals: string;
  behavior_constraints: string;
  current_status: string;
  expected_start_chapter: number | null;
  expected_end_chapter: number | null;
};

const emptyForm: CharacterForm = {
  name: "",
  level: "supporting",
  identity: "",
  goals: "",
  behavior_constraints: "",
  current_status: "",
  expected_start_chapter: null,
  expected_end_chapter: null,
};

export default function CharactersPanel({ novelId }: { novelId: number | null }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<CharacterForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!novelId) {
      setCharacters([]);
      setSelectedId(null);
      setForm(emptyForm);
      return;
    }

    let active = true;
    api.get<Character[]>(`/api/novels/${novelId}/characters`).then((data) => {
      if (!active) return;
      setCharacters(data);
      setSelectedId(data[0]?.id ?? null);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [novelId]);

  const selectedCharacter = characters.find((character) => character.id === selectedId) ?? null;

  useEffect(() => {
    setForm(selectedCharacter ? {
      name: selectedCharacter.name,
      level: selectedCharacter.level,
      identity: selectedCharacter.identity,
      goals: selectedCharacter.goals,
      behavior_constraints: selectedCharacter.behavior_constraints,
      current_status: selectedCharacter.current_status,
      expected_start_chapter: selectedCharacter.expected_start_chapter,
      expected_end_chapter: selectedCharacter.expected_end_chapter,
    } : emptyForm);
  }, [selectedCharacter?.id]);

  async function saveCharacter() {
    if (!novelId) return;

    setBusy(true);
    setError(null);
    try {
      if (selectedCharacter) {
        await api.put(`/api/novels/${novelId}/characters/${selectedCharacter.id}`, form);
      } else {
        await api.post(`/api/novels/${novelId}/characters`, form);
      }
      const data = await api.get<Character[]>(`/api/novels/${novelId}/characters`);
      setCharacters(data);
      setSelectedId(data[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>人物卡片</h2>
      <ul className="card-list">
        {characters.map((character) => (
          <li key={character.id}>
            <button
              type="button"
              className={character.id === selectedId ? "selected" : ""}
              onClick={() => setSelectedId(character.id)}
            >
              <strong>{character.name}</strong>
              <span>{character.level}</span>
              {character.identity ? <p>{character.identity}</p> : null}
              {character.goals ? <p>{character.goals}</p> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <input
          value={form.name}
          onChange={(event) => setForm({...form, name: event.target.value})}
          placeholder="姓名"
        />
        <input
          value={form.level}
          onChange={(event) => setForm({...form, level: event.target.value})}
          placeholder="级别"
        />
        <input
          value={form.identity}
          onChange={(event) => setForm({...form, identity: event.target.value})}
          placeholder="身份"
        />
        <input
          value={form.goals}
          onChange={(event) => setForm({...form, goals: event.target.value})}
          placeholder="目标"
        />
        <textarea
          value={form.behavior_constraints}
          onChange={(event) => setForm({...form, behavior_constraints: event.target.value})}
          placeholder="行为约束"
        />
        <div className="number-pair">
          <input
            type="number"
            value={form.expected_start_chapter ?? ""}
            onChange={(event) => setForm({
              ...form,
              expected_start_chapter: event.target.value ? Number(event.target.value) : null,
            })}
            placeholder="起始章"
          />
          <input
            type="number"
            value={form.expected_end_chapter ?? ""}
            onChange={(event) => setForm({
              ...form,
              expected_end_chapter: event.target.value ? Number(event.target.value) : null,
            })}
            placeholder="结束章"
          />
        </div>
      </div>
      <div className="toolbar">
        <button type="button" onClick={() => setSelectedId(null)}>新建</button>
        <button type="button" className="primary" disabled={busy} onClick={() => saveCharacter()}>
          保存
        </button>
      </div>
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
