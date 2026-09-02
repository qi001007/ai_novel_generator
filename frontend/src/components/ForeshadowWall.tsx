import { Flag, Sparkles } from "lucide-react";

export default function ForeshadowWall({ novelId }: { novelId: number | null }) {
  return (
    <section className="page-panel" aria-label="伏笔墙">
      <header className="page-panel-header">
        <h2>伏笔墙</h2>
        <button type="button" className="primary" disabled={!novelId} title="暂未开放">
          <Sparkles size={14} />
          AI 自检
        </button>
      </header>
      <div className="page-panel-empty">
        <Flag size={32} aria-hidden="true" />
        <h3>还没有伏笔</h3>
        <p>从章节简报或蓝图出发，埋下第一条伏笔线。</p>
      </div>
    </section>
  );
}
