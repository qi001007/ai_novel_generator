import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";

import { api } from "../api";
import type { PlotFeedback } from "../types";
import { Button, IconButton, TextArea, TextField, useToast } from "./ui";

export default function FeedbackPanel({ novelId }: { novelId: number | null }) {
  const { pushToast } = useToast();
  const [feedback, setFeedback] = useState<PlotFeedback[]>([]);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (novelId === null) return;
    setFeedback(await api.get<PlotFeedback[]>(`/api/novels/${novelId}/feedback`));
  }

  useEffect(() => {
    let active = true;
    if (novelId === null) return undefined;
    api.get<PlotFeedback[]>(`/api/novels/${novelId}/feedback`)
      .then((data) => active && setFeedback(data))
      .catch((cause: Error) => active && setError(cause.message));
    return () => { active = false; };
  }, [novelId]);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return feedback.filter((item) => !needle || item.content.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at));
  }, [feedback, query]);

  function begin(item?: PlotFeedback) {
    setEditingId(item?.id ?? "new");
    setContent(item?.content ?? "");
    setError(null);
  }

  async function save() {
    if (novelId === null || !content.trim()) return;
    setBusy(true);
    try {
      if (editingId === "new") await api.post(`/api/novels/${novelId}/feedback`, { content: content.trim() });
      else if (typeof editingId === "number") await api.put(`/api/novels/${novelId}/feedback/${editingId}`, { content: content.trim() });
      await reload();
      setEditingId(null);
      setContent("");
      pushToast("反馈备注已保存", "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally { setBusy(false); }
  }

  async function remove(item: PlotFeedback) {
    if (novelId === null || !window.confirm("删除这条反馈备注？")) return;
    setBusy(true);
    try {
      await api.del(`/api/novels/${novelId}/feedback/${item.id}`);
      await reload();
      if (editingId === item.id) {
        setEditingId(null);
        setContent("");
      }
      pushToast("反馈备注已删除", "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally { setBusy(false); }
  }

  return <section className="page-panel feedback-panel" aria-label="整本书反馈备注">
    <header className="page-panel-header feedback-header"><div><h2>反馈备注</h2><span>{shown.length}</span></div><Button compact onClick={() => begin()}><Plus size={13} />新增</Button></header>
    <label className="feedback-search"><Search size={13} /><TextField type="search" aria-label="搜索反馈" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索反馈内容" /></label>
    {editingId !== null ? <div className="feedback-editor">
      <TextArea aria-label="反馈内容" value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录需要长期关注的整本书问题" />
      <footer><Button compact onClick={() => { setEditingId(null); setContent(""); }}>取消</Button><Button compact tone="primary" disabled={busy || !content.trim()} onClick={() => void save()}>保存</Button></footer>
    </div> : null}
    {error ? <p className="status-error">{error}</p> : null}
    <ol className="feedback-notes" aria-label="反馈备注列表">
      {shown.map((item) => <li key={item.id}><p>{item.content}</p><footer><time>{new Date(item.updated_at || item.created_at).toLocaleString("zh-CN")}</time><IconButton aria-label={`编辑反馈 ${item.id}`} onClick={() => begin(item)}><Pencil size={13} /></IconButton><IconButton aria-label={`删除反馈 ${item.id}`} onClick={() => void remove(item)}><Trash2 size={13} /></IconButton></footer></li>)}
    </ol>
    {shown.length === 0 ? <p className="page-panel-empty">还没有反馈备注</p> : null}
  </section>;
}
