import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { ImagePlus, Settings, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { tokenValue } from "../store/appearance";
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

/* 第二十批批注 3：这本书写多少章、叫什么、简介是什么，建完就再没地方改。
   下面这一张表是本应用里「一本小说可编辑的字段」的唯一清单一一新建向导与
   「编辑信息」弹窗都渲染它。两处各列一遍，迟早长成「那边能改名、这边不能」。 */
type BookDraft = {
  title: string;
  description: string;
  targetChapters: number;
  styleConstraints: string;
};

const EMPTY_DRAFT: BookDraft = {
  title: "",
  description: "",
  targetChapters: 300,
  styleConstraints: "",
};

const draftOf = (novel: Novel): BookDraft => ({
  title: novel.title,
  description: novel.description ?? "",
  targetChapters: novel.target_chapters ?? 0,
  styleConstraints: novel.style_constraints ?? "",
});

type BookFieldDef = {
  key: keyof BookDraft;
  label: string;
  kind: "text" | "textarea" | "number";
  step: number;
  placeholder?: string;
};

const BOOK_FIELDS: BookFieldDef[] = [
  { key: "title", label: "书名", kind: "text", step: 0 },
  { key: "description", label: "一句话简介", kind: "textarea", step: 0 },
  { key: "targetChapters", label: "目标章数上限", kind: "number", step: 1 },
  { key: "styleConstraints", label: "文风约束", kind: "textarea", step: 1, placeholder: "如：快节奏、强钩子" },
];

function BookField(props: {
  field: BookFieldDef;
  draft: BookDraft;
  onEdit: (patch: Partial<BookDraft>) => void;
}) {
  const { field, draft, onEdit } = props;
  const value = draft[field.key];
  return (
    <label className="book-field">
      {field.label}
      {field.kind === "textarea" ? (
        <textarea
          rows={2}
          value={value as string}
          placeholder={field.placeholder}
          onChange={(event) => onEdit({ [field.key]: event.target.value })}
        />
      ) : (
        <input
          type={field.kind === "number" ? "number" : "text"}
          min={field.kind === "number" ? 0 : undefined}
          step={field.kind === "number" ? 1 : undefined}
          value={field.kind === "number" ? String(value) : (value as string)}
          placeholder={field.placeholder}
          onChange={(event) =>
            onEdit(
              field.kind === "number"
                ? { [field.key]: Number(event.target.value) }
                : { [field.key]: event.target.value },
            )
          }
        />
      )}
    </label>
  );
}

/* The book card's context menu. Same overlay, same widths, same "未开放" honesty as
   the tree's - a second menu language for the same app is how controls start to differ
   in ways nobody decided. */
const BOOK_MENU_WIDTH = 208;

type BookMenu = { x: number; y: number; id: number; title: string };

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
  const [draft, setDraft] = useState<BookDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  /* 弹窗里的初值来自服务器，不是本地那份可能已经过期的 novels 缓存。 */
  const [infoId, setInfoId] = useState<number | null>(null);
  const [infoDraft, setInfoDraft] = useState<BookDraft | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [bookMenu, setBookMenu] = useState<BookMenu | null>(null);
  const bookMenuRef = useRef<HTMLDivElement | null>(null);
  /* Where the menu came from, so closing it hands the focus back instead of dropping
     the keyboard reader on the top of the page. */
  const menuOpener = useRef<HTMLElement | null>(null);

  const coverTarget = novels.find((novel) => novel.id === coverEditId) ?? null;
  /* 前几轮点名项：八枚预设之外要有一枚真·调色盘。取色用的是系统取色器，
     不是我再画一个假色轮。当前色不在预设里时，选中态落在这枚上。 */
  const isCustomCover =
    coverColor !== "" && !COVER_COLORS.some((color) => color.value === coverColor);

  useEffect(() => {
    if (!bookMenu) return;
    function onPointerDown(event: MouseEvent) {
      if (!bookMenuRef.current?.contains(event.target as Node)) setBookMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setBookMenu(null);
      menuOpener.current?.focus();
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [bookMenu]);

  /** The one place that opens the cover editor - the pill on the cover and the menu
   *  item are two doors onto it, not two implementations. */
  function openCoverEditor(novel: Novel) {
    setCoverPreview(novel.cover_image || null);
    setCoverColor(novel.cover_color ?? "");
    setCoverError(null);
    setCoverEditId(novel.id);
  }

  function openBookMenu(event: ReactMouseEvent | ReactKeyboardEvent, novel: Novel) {
    event.preventDefault();
    event.stopPropagation();
    const host = event.currentTarget as HTMLElement;
    menuOpener.current = host;
    const rect = host.getBoundingClientRect();
    // A keyboard-opened menu has no pointer: it hangs off the card's own top-left.
    const rawX = "clientX" in event && event.clientX ? event.clientX : rect.left + 14;
    const rawY = "clientY" in event && event.clientY ? event.clientY : rect.top + 42;
    setBookMenu({
      x: Math.max(8, Math.min(rawX, window.innerWidth - BOOK_MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(rawY, window.innerHeight - 150)),
      id: novel.id,
      title: novel.title,
    });
  }

  const runBookAction = (action: () => void) => () => {
    setBookMenu(null);
    action();
  };

  useEffect(() => {
    if (!coverEditId && infoId === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCoverEditId(null);
      setInfoId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [coverEditId, infoId]);

  function openWizard() {
    setDraft(EMPTY_DRAFT);
    setStep(0);
    setWizardOpen(true);
  }

  function openInfoEditor(novel: Novel) {
    setInfoId(novel.id);
    setInfoDraft(null);
    setInfoError(null);
    api.get<Novel>(`/api/novels/${novel.id}`).then(
      (fresh) => setInfoDraft(draftOf(fresh)),
      (cause: unknown) => {
        setInfoDraft(draftOf(novel));
        setInfoError(cause instanceof Error ? `读不到最新值，显示的是本地缓存：${cause.message}` : "读不到最新值，显示的是本地缓存");
      },
    );
  }

  /* 空书名与重名在这里就拦住，不发一个注定 409 的请求：后端收空标题，
     发出去就会把一本书改成没名字。 */
  const infoProblem = !infoDraft
    ? null
    : !infoDraft.title.trim()
      ? "书名不能为空"
      : infoDraft.targetChapters < 0 || !Number.isInteger(infoDraft.targetChapters)
        ? "目标章数上限得是不小于 0 的整数"
        : novels.some((novel) => novel.id !== infoId && novel.title === infoDraft.title.trim())
          ? "已经有同一部作品叫这个名字"
          : null;

  function saveInfo() {
    if (infoId === null || !infoDraft || infoProblem) return;
    setBusy(true);
    setInfoError(null);
    updateNovel(infoId, {
      title: infoDraft.title.trim(),
      description: infoDraft.description,
      target_chapters: infoDraft.targetChapters,
      style_constraints: infoDraft.styleConstraints,
    })
      .then(() => {
        setInfoId(null);
        setInfoDraft(null);
      })
      .catch((cause: unknown) =>
        setInfoError(cause instanceof Error ? cause.message : "保存失败"),
      )
      .finally(() => setBusy(false));
  }

  async function submit() {
    setBusy(true);
    try {
      const novel = await createNovel({
        title: draft.title,
        description: draft.description,
        target_chapters: draft.targetChapters,
        style_constraints: draft.styleConstraints,
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
          {/* 批注 4: the workbench lost this two rounds ago and this one was left
              behind. 外观 in settings owns the theme now, from both entry points. */}
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
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter") {
                    void selectNovel(novel.id).then(() => navigate(`/novels/${novel.id}`));
                  }
                  // Windows' own convention for "the context menu, but from the keyboard"
                  if (event.key === "F10" && event.shiftKey) openBookMenu(event, novel);
                  if (event.key === "ContextMenu") openBookMenu(event, novel);
                }}
                onContextMenu={(event) => openBookMenu(event, novel)}
                aria-haspopup="menu"
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
                  {/* 前几轮点名项：动作收进右键，卡面这一枚改成纯图标（「按钮能用图标
                      就用图标」）。名字在 aria-label 与 title 里，说清是给哪本书换封面。 */}
                  <button
                    type="button"
                    className="icon-button cover-change-btn"
                    aria-label={`更换「${novel.title}」封面`}
                    title={`更换「${novel.title}」封面`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openCoverEditor(novel);
                    }}
                  >
                    <ImagePlus size={16} />
                  </button>
                  {/* 批注 24: the whole cover is the target and already navigates. */}
                  <div className="book-meta">
                    <h3>{novel.title}</h3>
                    <p className="book-desc">{novel.description || "还没有简介，去蓝图里写一句"}</p>
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
      {bookMenu ? (
        <div
          ref={bookMenuRef}
          className="tree-menu"
          role="menu"
          aria-label={`《${bookMenu.title}》的操作`}
          style={{ left: bookMenu.x, top: bookMenu.y, width: BOOK_MENU_WIDTH }}
        >
          <button
            type="button"
            role="menuitem"
            className="tree-menu-item primary"
            onClick={runBookAction(() => {
              void selectNovel(bookMenu.id).then(() => navigate(`/novels/${bookMenu.id}`));
            })}
          >
            <span>打开作品</span>
            <kbd>Enter</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-menu-item"
            onClick={runBookAction(() => {
              const novel = novels.find((item) => item.id === bookMenu.id);
              if (novel) openCoverEditor(novel);
            })}
          >
            <span>更换封面…</span>
            <kbd>悬停图标</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-menu-item"
            onClick={runBookAction(() => {
              const novel = novels.find((item) => item.id === bookMenu.id);
              if (novel) openInfoEditor(novel);
            })}
          >
            <span>编辑信息…</span>
            <kbd>书名 简介 章数</kbd>
          </button>
          <div className="tree-menu-sep" />
          {/* 与树的「重命名 / 删除」同一口径：没有通路就明说未开放，不摆一个会 405 的钮。 */}
          <button
            type="button"
            role="menuitem"
            className="tree-menu-item"
            disabled
            title="删除语义未定：与「反馈记录进不进文件层」「人物删除必然 405」是同一条决策"
          >
            <span>删除作品</span>
            <kbd>未开放</kbd>
          </button>
        </div>
      ) : null}
      {infoId !== null ? (
        <div
          className="wizard-backdrop"
          onClick={() => setInfoId(null)}
          role="presentation"
        >
          <div
            className="wizard book-info"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="编辑作品信息"
          >
            <header className="cover-modal-header">
              <h2>编辑信息</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={() => setInfoId(null)}
              >
                <X size={16} />
              </button>
            </header>
            {infoDraft
              ? BOOK_FIELDS.map((field) => (
                  <BookField
                    key={field.key}
                    field={field}
                    draft={infoDraft}
                    onEdit={(patch) => setInfoDraft({ ...infoDraft, ...patch })}
                  />
                ))
              : null}
            {!infoDraft ? <p className="book-info-note">正在从服务器读最新值</p> : null}
            {infoProblem || infoError ? (
              <p className="book-info-problem">{infoProblem ?? infoError}</p>
            ) : null}
            <footer className="cover-modal-footer">
              <button type="button" onClick={() => setInfoId(null)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !infoDraft || infoProblem !== null}
                onClick={saveInfo}
              >
                保存
              </button>
            </footer>
          </div>
        </div>
      ) : null}
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
            {/* 选完当场看得见：预览以前只读全局 --accent，挑的颜色要保存回书架
                才第一次出现，那等于让主人在盲选。
                「未选色」写成主色本身而不是删掉这个属性 - React 更新时不会把内联的
                自定义属性清回去（测试里量到的：从 {--book-accent:#123456} 变成
                undefined 之后，节点上留的还是 #123456），所以这里永远给一个具体值。 */}
            <div
              className="cover-preview"
              style={{ "--book-accent": coverColor || tokenValue("--accent") } as BookVars}
            >
              {coverPreview ? (
                <img src={coverPreview} alt={`${coverTarget.title} 封面预览`} />
              ) : (
                <span aria-hidden="true">{coverTarget.title.slice(0, 1)}</span>
              )}
            </div>
            <p className="cover-palette-label">书脊与封面色</p>
            <div className="cover-palette-row">
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
              {/* 不在 radiogroup 里：那一组的子项必须全是 radio，而这枚是取色器。 */}
              <label
                className={isCustomCover ? "cover-swatch-picker on" : "cover-swatch-picker"}
                title={isCustomCover ? `自定义 ${coverColor}` : "自定义封面颜色"}
              >
                <input
                  type="color"
                  aria-label="自定义封面颜色"
                  value={/^#[0-9a-f]{6}$/i.test(coverColor) ? coverColor : tokenValue("--accent")}
                  onChange={(event) => setCoverColor(event.target.value)}
                />
              </label>
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
            {/* 批注 11: the spec is not something to read, it is something to fail
                against. It now shows only when the pick is the wrong shape. */}
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
            {BOOK_FIELDS.filter((field) => field.step === step).map((field) => (
              <BookField
                key={field.key}
                field={field}
                draft={draft}
                onEdit={(patch) => setDraft({ ...draft, ...patch })}
              />
            ))}
            {step === 2 ? (
              <p>
                《{draft.title}》· 目标 {draft.targetChapters} 章
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
                  disabled={!draft.title.trim()}
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
