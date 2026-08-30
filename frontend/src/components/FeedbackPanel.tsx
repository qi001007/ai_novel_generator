import { useEffect, useState } from "react";

import { api } from "../api";
import type { PlotFeedback } from "../types";

type FeedbackForm = {
  id: number | null;
  content: string;
  impact_levels: string[];
  suggestions: string;
  status: string;
};

const emptyForm: FeedbackForm = {
  id: null,
  content: "",
  impact_levels: [],
  suggestions: "{}",
  status: "pending",
};

const levels = ["D", "C", "B", "A"];

export default function FeedbackPanel({ novelId }: { novelId: number | null }) {
  const [feedback, setFeedback] = useState<PlotFeedback[]>([]);
  const [form, setForm] = useState<FeedbackForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!novelId) return;

    let active = true;
    api.get<PlotFeedback[]>(`/api/novels/${novelId}/feedback`).then((data) => {
      if (!active) return;
      setFeedback(data);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [novelId]);

  async function save() {
    if (!novelId) return;

    setBusy(true);
    setError(null);
    try {
      const payload = {
        content: form.content,
        impact_levels: form.impact_levels,
        suggestions: JSON.parse(form.suggestions || "{}"),
        status: form.status,
      };
      if (form.id) {
        await api.put(`/api/novels/${novelId}/feedback/${form.id}`, payload);
      } else {
        await api.post(`/api/novels/${novelId}/feedback`, payload);
      }
      const data = await api.get<PlotFeedback[]>(`/api/novels/${novelId}/feedback`);
      setFeedback(data);
      setForm(emptyForm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>剧情反馈</h2>
      <ul className="record-list">
        {feedback.map((item) => (
          <li key={item.id}>
            <strong>{item.status}</strong>
            <p>{item.content}</p>
            <span>{item.impact_levels.join(" / ")}</span>
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <textarea
          value={form.content}
          onChange={(event) => setForm({...form, content: event.target.value})}
          placeholder="反馈内容"
        />
        <div className="level-row">
          {levels.map((level) => (
            <label key={level}>
              <input
                type="checkbox"
                checked={form.impact_levels.includes(level)}
                onChange={(event) => setForm({
                  ...form,
                  impact_levels: event.target.checked
                    ? [...form.impact_levels, level]
                    : form.impact_levels.filter((item) => item !== level),
                })}
              />
              {level}
            </label>
          ))}
        </div>
        <textarea
          value={form.suggestions}
          onChange={(event) => setForm({...form, suggestions: event.target.value})}
          placeholder="建议修改 JSON"
        />
        <select
          value={form.status}
          onChange={(event) => setForm({...form, status: event.target.value})}
        >
          <option value="pending">待确认</option>
          <option value="applied">已应用</option>
          <option value="rejected">已拒绝</option>
        </select>
      </div>
      <div className="toolbar">
        <button type="button" className="primary" disabled={busy || !novelId} onClick={() => save()}>
          保存反馈
        </button>
      </div>
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
