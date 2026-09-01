import { MapPin, Sparkles } from "lucide-react";

export default function WorldMapPanel({ novelId }: { novelId: number | null }) {
  return (
    <section className="page-panel" aria-label="世界观地图">
      <header className="page-panel-header">
        <h2>世界观 / 地图</h2>
        <button type="button" className="primary" disabled={!novelId} title="AI 生图接入 Phase 2">
          <Sparkles size={14} />
          AI 生成地图
        </button>
      </header>
      <div className="page-panel-empty">
        <MapPin size={32} aria-hidden="true" />
        <h3>还没有地图</h3>
        <p>从剧情弧或章节简报出发，让 AI 帮你画出第一张世界观地图。</p>
      </div>
    </section>
  );
}
