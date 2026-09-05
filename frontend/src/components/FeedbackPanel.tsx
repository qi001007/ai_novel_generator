import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

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

const statusLabels: Record<string, string> = {
  pending: "待确认",
  applied: "已应用",
  rejected: "已拒绝",
};

export default function FeedbackPanel({ novelId }: { novelId: number | null }) {
  const [feedback, setFeedback] = useState<PlotFeedback[]>([]);
  const [form, setForm] = useState<FeedbackForm>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
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
      <div className="feedback-header">
        <h2>反馈时间线</h2>
        <button
          type="button"
          className="primary"
          onClick={() => setFormOpen(!formOpen)}
          aria-expanded={formOpen}
        >
          <Plus size={14} />
          新增反馈
        </button>
      </div>

      {formOpen ? (
        <div className="feedback-form">
          <textarea
            value={form.content}
            onChange={(event) => setForm({...form, content: event.target.value})}
            placeholder="反馈内容"
            aria-label="反馈内容"
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
          <div className="feedback-form-footer">
            <button type="button" onClick={() => setFormOpen(false)}>取消</button>
            <button
              type="button"
              className="primary"
              disabled={busy || !novelId || !form.content.trim()}
              onClick={() => void save().then(() => setFormOpen(false))}
            >
              保存反馈
            </button>
          </div>
          {error ? <p className="status-error">{error}</p> : null}
        </div>
      ) : null}

      {feedback.length === 0 ? (
        <div className="feedback-empty">
          <p>还没有反馈记录</p>
        </div>
      ) : (
        <ol className="feedback-timeline" aria-label="反馈时间线">
          {feedback.map((item) => (
            <li key={item.id} className={`feedback-item status-${item.status}`}>
              <div className="feedback-marker" aria-hidden="true" />
              <div className="feedback-body">
                <div className="feedback-meta">
                  <span className={`badge ${item.status === "applied" ? "filled" : "warning"}`}>
                    {statusLabels[item.status] ?? item.status}
                  </span>
                  {item.impact_levels.length > 0 ? (
                    <span className="feedback-levels">
                      影响 {item.impact_levels.join(" / ")}
                    </span>
                  ) : null}
                  {item.created_at ? (
                    <time className="feedback-time">{item.created_at.slice(0, 10)}</time>
                  ) : null}
                </div>
                <p className="feedback-content">{item.content}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error ? <p className="status-error">{error}</p> : null}
    </section>
  );
}
