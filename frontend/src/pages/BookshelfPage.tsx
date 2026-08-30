import { useWorkbench } from "../store/workbench";

export default function BookshelfPage() {
  const novels = useWorkbench((state) => state.novels);
  const selectNovel = useWorkbench((state) => state.selectNovel);
  const setView = useWorkbench((state) => state.setView);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>墨阁</strong>
          <span>AI 长篇连载工作台</span>
        </div>
      </header>
      <main className="workspace">
        <section className="panel" style={{ width: "100%" }}>
          <h1>我的作品</h1>
          <ul className="item-list">
            {novels.map((novel) => (
              <li key={novel.id}>
                <button
                  type="button"
                  onClick={async () => {
                    await selectNovel(novel.id);
                    setView("workbench");
                  }}
                >
                  {novel.title}
                </button>
              </li>
            ))}
          </ul>
          <p>书架完整版在 C3 骨架阶段实现。</p>
        </section>
      </main>
    </div>
  );
}
