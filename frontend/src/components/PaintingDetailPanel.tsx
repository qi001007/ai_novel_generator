import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Clock, Download, Star } from "lucide-react";

type PaintingDetailPanelProps = {
  onBack?: () => void;
};

const historyItems = [
  { label: "v3 · 当前", time: "09-01 20:12", active: true },
  { label: "v2 · 增补旧道", time: "08-31 23:05", active: false },
  { label: "v1 · 初稿", time: "08-27 09:03", active: false },
];

const layers = ["星轨", "观星阁建筑", "九曜门旧道", "碑下裂隙"];

export default function PaintingDetailPanel({ onBack }: PaintingDetailPanelProps) {
  const navigate = useNavigate();
  const [selectedVersion, setSelectedVersion] = useState(0);
  const goBack = onBack ?? (() => navigate(-1));

  return (
    <section className="page-panel painting-detail" aria-label="绘画详情">
      <header className="painting-header">
        <button type="button" className="icon-button" aria-label="返回地图列表" onClick={goBack}>
          <ChevronLeft size={16} />
        </button>
        <h2>观星阁全域图 · 参考稿 v3</h2>
        <div className="painting-header-actions">
          <button type="button" className="secondary" title="下载参考图">
            <Download size={14} />
            下载
          </button>
          <button type="button" className="primary" title="设为参考">
            <Star size={14} />
            设为参考
          </button>
        </div>
      </header>

      <div className="painting-body">
        <div className="painting-canvas">
          <p className="painting-placeholder">地图预览（AI 生图暂未开放）</p>
          <p className="painting-meta">
            2048 × 2048 · 参考图水印 · 不作为事实来源
          </p>
        </div>

        <aside className="painting-sidebar">
          <section aria-label="本次调用">
            <h3>本次调用</h3>
            <dl className="painting-costs">
              <dt>模型</dt>
              <dd>文生图模型（待接）</dd>
              <dt>输入 token</dt>
              <dd className="tabular">3 412</dd>
              <dt>输出 token</dt>
              <dd className="tabular">1 046</dd>
              <dt>耗时</dt>
              <dd className="tabular">18.4 s</dd>
              <dt>成本估算</dt>
              <dd className="tabular">¥ 0.28</dd>
            </dl>
            <p className="painting-cost-note">数据缺失显示 —，不显示 0。</p>
          </section>
          <h3>提示词</h3>
          <div className="painting-prompt">
            中国水墨风格，观星阁穹顶星轨全图，深蓝夜空，朱砂印章点缀，青铜铭文边缘，分辨率 2048x2048。
          </div>

          <h3>
            <Clock size={14} aria-hidden="true" />
            生成历史
          </h3>
          <ol className="painting-history">
            {historyItems.map((item, idx) => (
              <li key={item.label}>
                <button
                  type="button"
                  className={`painting-history-item ${idx === selectedVersion ? "selected" : ""}`}
                  onClick={() => setSelectedVersion(idx)}
                >
                  <span>{item.label}</span>
                  <time>{item.time}</time>
                </button>
              </li>
            ))}
          </ol>

          <h3>图层</h3>
          <div className="painting-layer-tags">
            {layers.map((layer) => (
              <span key={layer} className="badge">{layer}</span>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
