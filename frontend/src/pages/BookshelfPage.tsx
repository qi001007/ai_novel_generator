import { useState } from "react";

import { useWorkbench } from "../store/workbench";

const STEPS = ["书名与简介", "篇幅与文风", "确认创建"];

export default function BookshelfPage() {
  const novels = useWorkbench((state) => state.novels);
  const theme = useWorkbench((state) => state.theme);
  const toggleTheme = useWorkbench((state) => state.toggleTheme);
  const selectNovel = useWorkbench((state) => state.selectNovel);
  const setView = useWorkbench((state) => state.setView);
  const createNovel = useWorkbench((state) => state.createNovel);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetChapters, setTargetChapters] = useState(300);
  const [styleConstraints, setStyleConstraints] = useState("");
  const [busy, setBusy] = useState(false);

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
      setView("workbench");
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
                onClick={async () => {
                  await selectNovel(novel.id);
                  setView("workbench");
                }}
              >
                <div className="book-cover">
                  <span>{novel.title.slice(0, 1)}</span>
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
