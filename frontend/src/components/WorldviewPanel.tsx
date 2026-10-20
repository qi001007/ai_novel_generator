import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, FilePenLine, Search } from "lucide-react";

import { api } from "../api";
import { useFiles } from "../store/files";
import type { WorldviewEntry } from "../types";
import { Button, Combobox, TextField } from "./ui";

type SortKey = "updated" | "name" | "category" | "source";

export default function WorldviewPanel({ novelId, path }: { novelId: number | null; path: string | null }) {
  const openFile = useFiles((state) => state.open);
  const [entries, setEntries] = useState<WorldviewEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (novelId === null) return;
    let active = true;
    api.get<WorldviewEntry[]>(`/api/novels/${novelId}/settings`)
      .then((data) => {
        if (!active) return;
        setEntries(data);
        setSelectedId((current) => current && data.some((item) => item.id === current) ? current : data[0]?.id ?? null);
      })
      .catch((cause: Error) => active && setError(cause.message));
    return () => { active = false; };
  }, [novelId]);

  const categories = useMemo(() => [...new Set(entries.map((item) => item.category).filter(Boolean))].sort(), [entries]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (status === "approved" && !item.is_confirmed) return false;
      if (status === "draft" && item.is_confirmed) return false;
      return !needle || `${item.name} ${item.category} ${item.current_state} ${item.content}`.toLocaleLowerCase().includes(needle);
    }).sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
      if (sort === "category") return a.category.localeCompare(b.category, "zh-CN") || a.name.localeCompare(b.name, "zh-CN");
      if (sort === "source") return (a.source_chapter ?? Number.MAX_SAFE_INTEGER) - (b.source_chapter ?? Number.MAX_SAFE_INTEGER);
      return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    });
  }, [category, entries, query, sort, status]);

  useEffect(() => {
    if (shown.some((item) => item.id === selectedId)) return;
    setSelectedId(shown[0]?.id ?? null);
  }, [selectedId, shown]);

  const selected = entries.find((item) => item.id === selectedId) ?? null;

  return <section className="page-panel worldview-panel" aria-label="世界观资料库">
    <header className="page-panel-header worldview-header">
      <div><h2>世界观</h2><span>{shown.length} / {entries.length}</span></div>
      <Button compact disabled={!path} onClick={() => path && void openFile(path)}><FilePenLine size={13} />编辑源文件</Button>
    </header>
    <div className="worldview-toolbar">
      <label className="worldview-search"><Search size={13} /><TextField type="search" aria-label="搜索世界观" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、类别或内容" /></label>
      <Combobox ariaLabel="世界观类别" value={category} onChange={setCategory} options={[{ value: "all", label: "全部类别" }, ...categories.map((value) => ({ value, label: value }))]} />
      <Combobox ariaLabel="世界观审批状态" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "approved", label: "已确认" }, { value: "draft", label: "草稿" }]} />
      <Combobox ariaLabel="世界观排序" value={sort} onChange={(value) => setSort(value as SortKey)} options={[{ value: "updated", label: "最近更新" }, { value: "name", label: "名称" }, { value: "category", label: "类别" }, { value: "source", label: "来源章节" }]} />
    </div>
    {error ? <p className="status-error">{error}</p> : null}
    <div className="worldview-layout">
      <div className="worldview-list" role="list" aria-label="世界观条目">
        {shown.map((item) => <button type="button" role="listitem" className={item.id === selectedId ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
          <span className="worldview-card-title"><strong>{item.name}</strong>{item.is_confirmed ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}</span>
          <span>{item.category || "未分类"}</span>
          <small>{item.current_state || item.content || "暂无摘要"}</small>
        </button>)}
        {shown.length === 0 ? <p className="page-panel-empty">没有匹配的世界观条目</p> : null}
      </div>
      <article className="worldview-detail">
        {selected ? <>
          <header><div><span>{selected.category || "未分类"}</span><h3>{selected.name}</h3></div><i data-approved={selected.is_confirmed}>{selected.is_confirmed ? "已确认" : "草稿"}</i></header>
          <dl><div><dt>来源章节</dt><dd>{selected.source_chapter ?? "未指定"}</dd></div><div><dt>最近更新</dt><dd>{new Date(selected.updated_at).toLocaleString("zh-CN")}</dd></div></dl>
          {selected.current_state ? <section><h4>现况</h4><p>{selected.current_state}</p></section> : null}
          <section><h4>内容</h4><p>{selected.content || "暂无内容"}</p></section>
          {selected.custom_sections.map((section, index) => <section key={`${section.title}-${index}`}><h4>{section.title}</h4><p>{section.content}</p></section>)}
        </> : <p className="page-panel-empty">选择一条设定查看详情</p>}
      </article>
    </div>
  </section>;
}
