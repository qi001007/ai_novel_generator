import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, FilePenLine, Flag, Search } from "lucide-react";

import { api } from "../api";
import { useFiles } from "../store/files";
import type { ForeshadowEntry } from "../types";
import { Button, Combobox, TextField } from "./ui";

type SortKey = "planted" | "title" | "updated";

export default function ForeshadowWall({ novelId, path }: { novelId: number | null; path: string | null }) {
  const openFile = useFiles((state) => state.open);
  const [entries, setEntries] = useState<ForeshadowEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("planted");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (novelId === null) return;
    let active = true;
    api.get<ForeshadowEntry[]>(`/api/novels/${novelId}/foreshadows`)
      .then((data) => {
        if (!active) return;
        setEntries(data);
        setSelectedId((current) => current && data.some((item) => item.id === current) ? current : data[0]?.id ?? null);
      })
      .catch((cause: Error) => active && setError(cause.message));
    return () => { active = false; };
  }, [novelId]);

  const statuses = useMemo(() => [...new Set(entries.map((item) => item.status).filter(Boolean))].sort(), [entries]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      return !needle || `${item.title} ${item.content} ${item.custom_sections.map((section) => section.content).join(" ")}`.toLocaleLowerCase().includes(needle);
    }).sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, "zh-CN");
      if (sort === "updated") return Date.parse(b.updated_at) - Date.parse(a.updated_at);
      return a.planted_chapter - b.planted_chapter || a.title.localeCompare(b.title, "zh-CN");
    });
  }, [entries, query, sort, status]);

  useEffect(() => {
    if (shown.some((item) => item.id === selectedId)) return;
    setSelectedId(shown[0]?.id ?? null);
  }, [selectedId, shown]);

  const selected = entries.find((item) => item.id === selectedId) ?? null;

  return <section className="page-panel worldview-panel" aria-label="伏笔墙">
    <header className="page-panel-header worldview-header">
      <div><h2>伏笔墙</h2><span>{shown.length} / {entries.length}</span></div>
      <Button compact disabled={!path} onClick={() => path && void openFile(path)}><FilePenLine size={13} />编辑源文件</Button>
    </header>
    <div className="worldview-toolbar">
      <label className="worldview-search"><Search size={13} /><TextField type="search" aria-label="搜索伏笔" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、状态或内容" /></label>
      <Combobox ariaLabel="伏笔状态" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, ...statuses.map((value) => ({ value, label: value }))]} />
      <Combobox ariaLabel="伏笔排序" value={sort} onChange={(value) => setSort(value as SortKey)} options={[{ value: "planted", label: "埋设章" }, { value: "title", label: "名称" }, { value: "updated", label: "最近更新" }]} />
    </div>
    {error ? <p className="status-error">{error}</p> : null}
    <div className="worldview-layout">
      <div className="worldview-list" role="list" aria-label="伏笔条目">
        {shown.map((item) => <button type="button" role="listitem" className={item.id === selectedId ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
          <span className="worldview-card-title"><strong>{item.title}</strong>{item.status === "open" ? <CircleDashed size={13} /> : <CheckCircle2 size={13} />}</span>
          <span>第 {item.planted_chapter} 章埋设</span>
          <small>{item.content || "暂无摘要"}</small>
        </button>)}
        {shown.length === 0 ? <p className="worldview-list-empty">还没有伏笔</p> : null}
      </div>
      <article className="worldview-detail">
        {selected ? <>
          <header><div><span>{selected.status === "open" ? "未回收" : selected.status}</span><h3>{selected.title}</h3></div><i data-approved={selected.payoff_chapter != null}>{selected.payoff_chapter != null ? "已回收" : "进行中"}</i></header>
          <dl><div><dt>埋设章</dt><dd>{selected.planted_chapter}</dd></div><div><dt>预计收章</dt><dd>{selected.expected_payoff_chapter ?? "未指定"}</dd></div><div><dt>已收章</dt><dd>{selected.payoff_chapter ?? "—"}</dd></div></dl>
          <section><h4>内容</h4><p>{selected.content || "暂无内容"}</p></section>
          {selected.custom_sections.map((section, index) => <section key={`${section.title}-${index}`}><h4>{section.title}</h4><p>{section.content}</p></section>)}
        </> : <div className="page-panel-empty"><Flag size={22} aria-hidden="true" /><p>选择一条伏笔查看详情</p></div>}
      </article>
    </div>
  </section>;
}