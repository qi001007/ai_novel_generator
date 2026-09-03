import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import StatusBadge from "./StatusBadge";
import { useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";

type TocRow = { chapter: number; title: string; plot_function: string; notes: string };

const PREAMBLE_END = "\n\n";

function parseToc(text: string): { preamble: string; rows: TocRow[] } {
  const firstHeading = text.indexOf("\n## 第");
  const preamble = firstHeading === -1 ? text : text.slice(0, firstHeading + 1);
  const body = firstHeading === -1 ? "" : text.slice(firstHeading + 1);
  const rows: TocRow[] = [];
  let current: TocRow | null = null;
  for (const line of body.split("\n")) {
    const heading = /^##\s+第\s*(\d+)\s*章\s*(.*)$/.exec(line);
    if (heading) {
      current = {
        chapter: Number(heading[1]),
        title: heading[2].trim(),
        plot_function: "",
        notes: "",
      };
      rows.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = /^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/.exec(line);
    if (bullet?.[1] === "剧情功能") current.plot_function = bullet[2];
    if (bullet?.[1] === "备注") current.notes = bullet[2];
  }
  return { preamble, rows };
}

function renderToc(preamble: string, rows: TocRow[]) {
  const body = rows
    .map(
      (row) =>
        `## 第 ${row.chapter} 章 ${row.title}\n` +
        `- **剧情功能**：${row.plot_function}\n` +
        `- **备注**：${row.notes}\n`,
    )
    .join("\n");
  return `${preamble.trimEnd()}${PREAMBLE_END}${body}`;
}

type TocListViewProps = { onUseSource: () => void };

export default function TocListView({ onUseSource }: TocListViewProps) {
  const active = useFiles((store) => store.active);
  const entry = useFiles((store) => store.entries[active ?? ""]);
  const setDraft = useFiles((store) => store.setDraft);
  const save = useFiles((store) => store.save);
  const chapters = useWorkbench((store) => store.chapters);
  const [query, setQuery] = useState("");

  const parsed = useMemo(() => parseToc(entry?.draft ?? ""), [entry?.draft]);
  const allRows = useMemo(() => {
    const known = new Map(parsed.rows.map((row) => [row.chapter, row]));
    // A chapter can exist before its B-layer row is filled. Show it as a
    // missing row so the directory stays in step with the chapter list.
    chapters.forEach((chapter) => {
      if (!known.has(chapter.chapter_number)) {
        known.set(chapter.chapter_number, {
          chapter: chapter.chapter_number,
          title: chapter.title || "未命名",
          plot_function: "",
          notes: "",
        });
      }
    });
    return [...known.values()].sort((a, b) => a.chapter - b.chapter);
  }, [chapters, parsed.rows]);
  const normalizedQuery = query.trim().toLowerCase();
  const rows = allRows.filter((row) =>
    [row.title, row.plot_function, row.notes].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );

  if (!entry?.doc) return null;

  function updateRow(chapter: number, patch: Partial<TocRow>) {
    if (!entry?.doc) return;
    const next = allRows.map((row) =>
      row.chapter === chapter ? { ...row, ...patch } : row,
    );
    setDraft(entry.doc.path, renderToc(parsed.preamble, next));
  }

  return (
    <section className="toc-list" aria-label="目录列表">
      <div className="toc-toolbar">
        <div className="toc-title-group">
          <span className="file-path">规划 / toc.md</span>
          <h2>目录</h2>
        </div>
        <div className="toc-toolbar-controls">
          <div className="segmented" role="radiogroup" aria-label="目录视图">
            <button type="button" role="radio" aria-checked className="selected" disabled>
              列表
            </button>
            <button type="button" role="radio" aria-checked={false} onClick={onUseSource}>
              源码
            </button>
          </div>
          <label className="toc-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              placeholder="搜索章名 / 剧情功能"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!entry.doc || entry.saving || entry.draft === entry.doc.text}
            onClick={() => active && void save(active)}
          >
            {entry.saving ? "写入中" : "保存"}
          </button>
        </div>
      </div>

      <div className="toc-table" role="table">
        <div className="toc-head" role="row">
          <span>章号</span>
          <span>章名</span>
          <span>剧情功能</span>
          <span>状态</span>
        </div>
        {rows.map((row) => {
          const chapter = chapters.find((item) => item.chapter_number === row.chapter);
          return (
            <div className="toc-row" role="row" key={row.chapter}>
              <span className="tabular" title="章号是主键，列表内不可改号">
                {row.chapter} <Lock />
              </span>
              <input
                value={row.title}
                className={
                  normalizedQuery && row.title.toLowerCase().includes(normalizedQuery)
                    ? "toc-hit-field"
                    : ""
                }
                onChange={(event) => updateRow(row.chapter, { title: event.target.value })}
                aria-label={`第 ${row.chapter} 章章名`}
              />
              <textarea
                value={row.plot_function}
                rows={1}
                onChange={(event) => updateRow(row.chapter, { plot_function: event.target.value })}
                aria-label={`第 ${row.chapter} 章剧情功能`}
              />
              <StatusBadge status={chapter?.status ?? "missing"} />
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="toc-empty">
            没有匹配「{query}」的章节
            <button type="button" onClick={() => setQuery("")}>清除搜索</button>
          </div>
        )}
      </div>

      <footer className="toc-foot">
        <span className="tabular">
          {query ? `匹配 ${rows.length} / 共 ${allRows.length} 章 · Esc 清除搜索` : `共 ${allRows.length} 章`}
        </span>
        <span>章号是主键，列表内不可改号、不可删行下线</span>
      </footer>
    </section>
  );
}

function Lock() {
  return <span aria-hidden="true" className="toc-lock">锁</span>;
}
