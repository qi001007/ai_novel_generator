import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ImagePlus, Moon, Settings, Sun, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useWorkbench } from "../store/workbench";
import type { Novel, NovelUpdatePayload } from "../types";

const STEPS = ["书名与简介", "篇幅与文风", "确认创建"];

/* Owner asked for a palette instead of the red spine I had picked for every book.
   Empty value means "follow the workbench accent", so an unset novel is not a
   different-looking book - it is the default. */
const COVER_COLORS = [
  { value: "", label: "默认（跟随工作台主色）" },
  { value: "#c2492f", label: "朱" },
  { value: "#8f3b2e", label: "赭" },
  { value: "#6b5330", label: "褐" },
  { value: "#2f6b57", label: "青碧" },
  { value: "#2f4a63", label: "黛蓝" },
  { value: "#5a4668", label: "紫棠" },
  { value: "#7d2f3f", label: "绛" },
  { value: "#37423b", label: "松烟" },
];

/* The stamps come back as naive UTC, so without an explicit zone the browser reads
   them as local and every "3 天前" is off by eight hours. */
function parseStamp(iso: string): Date {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? new Date(iso) : new Date(iso + "Z");
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const then = parseStamp(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  const date = parseStamp(iso);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatWords(count?: number): string {
  if (count === undefined) return "—";
  return count >= 10000 ? `${(count / 10000).toFixed(1)} 万字` : `${count} 字`;
}

function progressPercent(novel: Novel): number | null {
  const done = novel.done_count;
  const span = novel.target_chapters || novel.chapter_count;
  if (done === undefined || !span) return null;
  return Math.min(100, Math.round((done / span) * 100));
}


// Same trick EditorPane uses for inline custom properties.
type BookVars = CSSProperties & Record<`--${string}`, string | number>;

export default function BookshelfPage() {
  const novels = useWorkbench((state) => state.novels);
  const theme = useWorkbench((state) => state.theme);
  const toggleTheme = useWorkbench((state) => state.toggleTheme);
  const selectNovel = useWorkbench((state) => state.selectNovel);
  const updateNovel = useWorkbench((state) => state.updateNovel);
  const navigate = useNavigate();
  const createNovel = useWorkbench((state) => state.createNovel);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [coverEditId, setCoverEditId] = useState<number | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverColor, setCoverColor] = useState("");
  const [coverError, setCoverError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetChapters, setTargetChapters] = useState(300);
  const [styleConstraints, setStyleConstraints] = useState("");
  const [busy, setBusy] = useState(false);

  const coverTarget = novels.find((novel) => novel.id === coverEditId) ?? null;

  useEffect(() => {
    if (!coverEditId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCoverEditId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [coverEditId]);

  function openWizard() {
    setTitle("");
    setDescription("");
    setTargetChapters(300);
    setStyleConstraints("");
    setStep(0);
    setWizardOpen(true);
  }

  async function submit() {
    setBusy(true);
    try {
      const novel = await createNovel({
        title,
        description,
        target_chapters: targetChapters,
        style_constraints: styleConstraints,
      });
      setWizardOpen(false);
      await selectNovel(novel.id);
      navigate(`/novels/${novel.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>墨阁</strong>
          <span>AI 长篇连载工作台</span>
        </div>
        <div className="topbar-actions">
          <button type="button" aria-label="设置" title="设置" onClick={() => navigate("/settings")}>
            <Settings size={16} />
          </button>
          <button type="button" aria-label="切换主题" title="切换主题" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      <main className="bookshelf-main">
        <div className="bookshelf-header">
          <h1>我的作品</h1>
          {/* 批注 1: the grid already ends with a 新建作品 card, so a filled button
              up here said the same thing twice and was the loudest object on the page. */}
        </div>
        {novels.length === 0 ? (
          <section className="panel empty-state">
            <h2>你的第一部作品从这里开始</h2>
            <button type="button" className="primary" onClick={openWizard}>
              新建作品
            </button>
          </section>
        ) : (
          <div className="bookshelf-grid">
            {novels.map((novel) => (
              <div className="book-slot" key={novel.id}>
              <article
                className="book-card"
                data-novel-id={novel.id}
                style={novel.cover_color ? ({ "--book-accent": novel.cover_color } as BookVars) : undefined}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.target === event.currentTarget) {
                    void selectNovel(novel.id).then(() => navigate(`/novels/${novel.id}`));
                  }
                }}
                onClick={async () => {
                  await selectNovel(novel.id);
                  navigate(`/novels/${novel.id}`);
                }}
              >
                <span className="book-spine" aria-hidden="true" />
                <span className="book-top" aria-hidden="true" />
                <span className="book-fore-edge" aria-hidden="true" />
                <div className="book-face">
                  {novel.cover_image ? (
                    <img
                      className="book-cover-img"
                      src={novel.cover_image}
                      alt={`${novel.title} 封面`}
                    />
                  ) : (
                    <span className="book-monogram" aria-hidden="true">
                      {novel.title.slice(0, 1)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="cover-change-btn"
                    aria-label={`更换「${novel.title}」封面`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setCoverPreview(novel.cover_image || null);
                      setCoverColor(novel.cover_color ?? "");
                      setCoverError(null);
                      setCoverEditId(novel.id);
                    }}
                  >
                    <ImagePlus size={14} />
                    更换封面
                  </button>
                  {/* 批注 24: the whole cover is the target and already navigates. */}
                  <div className="book-meta">
                    <h3>{novel.title}</h3>
                    <p className="book-desc">{novel.description || "还没有简介，去蓝图里写一句。"}</p>
                    {progressPercent(novel) === null ? null : (
                      <div
                        className="book-progress"
                        role="progressbar"
                        aria-valuenow={progressPercent(novel) ?? 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`已完成 ${novel.done_count ?? 0} 章，共 ${novel.target_chapters || novel.chapter_count || 0} 章目标`}
                      >
                        <span style={{ width: `${progressPercent(novel)}%` }} />
                      </div>
                    )}
                    <p className="book-stats">
                      <span>
                        {novel.chapter_count === undefined
                          ? "—"
                          : `${novel.chapter_count}${novel.target_chapters ? " / " + novel.target_chapters : ""} 章`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatWords(novel.total_words)}</span>
                    </p>
                    <p className="book-updated">最近编辑 {relativeTime(novel.last_edited_at)}</p>
                  </div>
                </div>
              </article>
              </div>
            ))}
            <div className="book-slot">
              <button type="button" className="book-card book-new-card" onClick={openWizard}>
                <span className="book-face">
                  <span className="book-new-plus" aria-hidden="true">+</span>
                  <span className="book-new-label">新建作品</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </main>
      {coverTarget ? (
        <div
          className="wizard-backdrop"
          onClick={() => setCoverEditId(null)}
          role="presentation"
        >
          <div
            className="wizard cover-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="封面编辑"
          >
            <header className="cover-modal-header">
              <h2>封面编辑</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={() => setCoverEditId(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="cover-preview">
              {coverPreview ? (
                <img src={coverPreview} alt={`${coverTarget.title} 封面预览`} />
              ) : (
                <span aria-hidden="true">{coverTarget.title.slice(0, 1)}</span>
              )}
            </div>
            <p className="cover-palette-label">书脊与封面色</p>
            <div className="cover-palette" role="radiogroup" aria-label="封面颜色">
              {COVER_COLORS.map((color) => (
                <button
                  key={color.value || "default"}
                  type="button"
                  role="radio"
                  aria-checked={coverColor === color.value}
                  aria-label={color.label}
                  title={color.label}
                  className={color.value ? "swatch" : "swatch swatch-default"}
                  style={color.value ? { background: color.value } : undefined}
                  onClick={() => setCoverColor(color.value)}
                />
              ))}
            </div>
            <div className="cover-actions">
              <label className="cover-upload">
                <Upload size={14} />
                上传封面
                <input
                  type="file"
                  accept="image/*"
                  aria-label="上传封面文件"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setCoverError(null);
                    // A data URL is what the backend stores, so the pick survives a reload.
                    const reader = new FileReader();
                    reader.onload = () =>
                      setCoverPreview(typeof reader.result === "string" ? reader.result : null);
                    reader.onerror = () => setCoverError("读取图片失败，请换一张");
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <button type="button" className="primary" disabled title="暂未开放">
                AI 生成
              </button>
            </div>
            <p className="cover-hint">建议比例 3:4，最小 720×960。</p>
            {coverError ? <p className="cover-error">{coverError}</p> : null}
            <footer className="cover-modal-footer">
              <button type="button" onClick={() => setCoverEditId(null)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={
                  busy || (!coverPreview && coverColor === (coverTarget?.cover_color ?? ""))
                }
                onClick={() => {
                  if (!coverTarget) return;
                  setBusy(true);
                  const payload: NovelUpdatePayload = { cover_color: coverColor };
                  if (coverPreview) payload.cover_image = coverPreview;
                  updateNovel(coverTarget.id, payload)
                    .then(() => {
                      setCoverEditId(null);
                      setCoverPreview(null);
                    })
                    .catch((cause: unknown) =>
                      setCoverError(cause instanceof Error ? cause.message : "封面保存失败"),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                保存
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      {wizardOpen ? (
        <div className="wizard-backdrop" onClick={() => setWizardOpen(false)}>
          <div className="wizard" onClick={(event) => event.stopPropagation()}>
            <h2>{STEPS[step]}</h2>
            {step === 0 ? (
              <>
                <input
                  value={title}
                  placeholder="书名"
                  onChange={(event) => setTitle(event.target.value)}
                />
                <textarea
                  value={description}
                  placeholder="一句话简介"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </>
            ) : null}
            {step === 1 ? (
              <>
                <input
                  type="number"
                  value={targetChapters}
                  onChange={(event) => setTargetChapters(Number(event.target.value))}
                />
                <textarea
                  value={styleConstraints}
                  placeholder="文风约束，如：快节奏、强钩子"
                  onChange={(event) => setStyleConstraints(event.target.value)}
                />
              </>
            ) : null}
            {step === 2 ? (
              <p>
                《{title}》· 目标 {targetChapters} 章
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {step > 0 ? (
                <button type="button" onClick={() => setStep(step - 1)}>
                  上一步
                </button>
              ) : null}
              {step < 2 ? (
                <button
                  type="button"
                  className="primary"
                  disabled={!title.trim()}
                  onClick={() => setStep(step + 1)}
                >
                  下一步
                </button>
              ) : (
                <button type="button" className="primary" disabled={busy} onClick={submit}>
                  创建
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
