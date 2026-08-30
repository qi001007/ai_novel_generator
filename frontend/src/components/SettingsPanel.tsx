import { useEffect, useState } from "react";

import { api } from "../api";
import type { Setting } from "../types";

type SettingForm = {
  category: string;
  name: string;
  content: string;
  current_state: string;
  is_confirmed: boolean;
  source_chapter: number | null;
};

const emptyForm: SettingForm = {
  category: "worldview",
  name: "",
  content: "",
  current_state: "",
  is_confirmed: false,
  source_chapter: null,
};

export default function SettingsPanel({ novelId }: { novelId: number | null }) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<SettingForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!novelId) {
      setSettings([]);
      setSelectedId(null);
      setForm(emptyForm);
      return;
    }

    let active = true;
    api.get<Setting[]>(`/api/novels/${novelId}/settings`).then((data) => {
      if (!active) return;
      setSettings(data);
      setSelectedId(data[0]?.id ?? null);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [novelId]);

  const selectedSetting = settings.find((setting) => setting.id === selectedId) ?? null;

  useEffect(() => {
    setForm(selectedSetting ? {
      category: selectedSetting.category,
      name: selectedSetting.name,
      content: selectedSetting.content,
      current_state: selectedSetting.current_state,
      is_confirmed: selectedSetting.is_confirmed,
      source_chapter: selectedSetting.source_chapter,
    } : emptyForm);
  }, [selectedSetting?.id]);

  async function saveSetting() {
    if (!novelId) return;

    setBusy(true);
    setError(null);
    try {
      if (selectedSetting) {
        await api.put(`/api/novels/${novelId}/settings/${selectedSetting.id}`, form);
      } else {
        await api.post(`/api/novels/${novelId}/settings`, form);
      }
      const data = await api.get<Setting[]>(`/api/novels/${novelId}/settings`);
      setSettings(data);
      setSelectedId(data[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>设定库</h2>
      <ul className="card-list">
        {settings.map((setting) => (
          <li key={setting.id}>
            <button
              type="button"
              className={setting.id === selectedId ? "selected" : ""}
              onClick={() => setSelectedId(setting.id)}
            >
              <strong>{setting.name}</strong>
              <span>{setting.category}</span>
              {setting.content ? <p>{setting.content}</p> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <input
          value={form.category}
          onChange={(event) => setForm({...form, category: event.target.value})}
          placeholder="分类"
        />
        <input
          value={form.name}
          onChange={(event) => setForm({...form, name: event.target.value})}
          placeholder="名称"
        />
        <textarea
          value={form.content}
          onChange={(event) => setForm({...form, content: event.target.value})}
          placeholder="内容"
        />
        <label>
          <input
            type="checkbox"
            checked={form.is_confirmed}
            onChange={(event) => setForm({...form, is_confirmed: event.target.checked})}
          />
          已确认
        </label>
      </div>
      <div className="toolbar">
        <button type="button" onClick={() => setSelectedId(null)}>新建</button>
        <button type="button" className="primary" disabled={busy} onClick={() => saveSetting()}>
          保存
        </button>
      </div>
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
