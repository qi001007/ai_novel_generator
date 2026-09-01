import { useEffect, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useWorkbench } from "../store/workbench";

const STEPS = ["书名与简介", "篇幅与文风", "确认创建"];

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
        <div />
        <div />
        <button type="button" onClick={toggleTheme}>
          {theme === "dark" ? "浅色" : "深色"}
        </button>
      </header>
      <main className="bookshelf-main">
        <div className="bookshelf-header">
          <h1>我的作品</h1>
          <button type="button" className="primary" onClick={openWizard}>
            新建作品
          </button>
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
              <article
                key={novel.id}
                className="book-card"
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
                <div className="book-cover">
                  {novel.cover_image ? (
                    <img src={novel.cover_image} alt={`${novel.title} 封面`} />
                  ) : (
                    <span aria-hidden="true">{novel.title.slice(0, 1)}</span>
                  )}
                  <button
                    type="button"
                    className="cover-change-btn"
                    aria-label={`更换「${novel.title}」封面`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setCoverPreview(novel.cover_image || null);
                      setCoverError(null);
                      setCoverEditId(novel.id);
                    }}
                  >
                    <ImagePlus size={14} />
                    更换封面
                  </button>
                </div>
                <div className="book-card-body">
                  <h3>{novel.title}</h3>
                  <p>{novel.description || "暂无简介"}</p>
                  <p>目标 {novel.target_chapters} 章</p>
                </div>
              </article>
            ))}
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
              <button type="button" className="primary" disabled title="AI 生图接入 Phase 2">
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
                disabled={!coverPreview || busy}
                onClick={() => {
                  if (!coverTarget || !coverPreview) return;
                  setBusy(true);
                  updateNovel(coverTarget.id, { cover_image: coverPreview })
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
