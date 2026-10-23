import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Image, MapPin, Sparkles } from "lucide-react";

import { api } from "../api";
import type { MapSummary } from "../types";
import { formatTime } from "../utils/time";
import MapGenerateDialog from "./MapGenerateDialog";
import { Button } from "./ui";

export default function WorldMapPanel({ novelId }: { novelId: number | null }) {
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (novelId == null) {
      setMaps([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    api
      .get<MapSummary[]>(`/api/novels/${novelId}/maps`)
      .then((rows) => {
        if (alive) setMaps(rows);
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : "地图列表加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [novelId, reloadKey]);

  return (
    <section className="page-panel" aria-label="世界观地图">
      <header className="page-panel-header">
        <h2>世界观 / 地图</h2>
        <Button
          tone="primary"
          disabled={novelId == null}
          onClick={() => setCreating(true)}
        >
          <Sparkles size={14} />
          AI 生成地图
        </Button>
      </header>

      {error ? (
        <p className="map-list-error" role="alert">
          {error}
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
            重试
          </button>
        </p>
      ) : null}

      {loading && maps.length === 0 ? <p className="map-list-loading">正在读取地图…</p> : null}

      {!loading && maps.length === 0 ? (
        <div className="page-panel-empty">
          <MapPin size={32} aria-hidden="true" />
          <h3>还没有地图</h3>
          <p>从剧情弧或章节简报出发，让 AI 帮你画出第一张世界观地图</p>
          <Button
            tone="primary"
            disabled={novelId == null}
            onClick={() => setCreating(true)}
          >
            生成第一张地图
          </Button>
        </div>
      ) : null}

      {maps.length > 0 ? (
        <ul className="map-list" aria-label="地图列表">
          {maps.map((map) => (
            <li key={map.id}>
              <button
                type="button"
                className="map-card"
                onClick={() => navigate(`/novels/${map.novel_id}/artworks/${map.id}`)}
              >
                <span className="map-card-thumb">
                  {map.preview_url ? (
                    <img src={map.preview_url} alt={`${map.name} 预览`} loading="lazy" />
                  ) : (
                    <Image size={22} aria-hidden="true" />
                  )}
                </span>
                <span className="map-card-body">
                  <strong>{map.name}</strong>
                  <span className="map-card-meta">
                    <span>
                      {map.revision === 0
                        ? "还没有生成版本"
                        : map.active_revision
                          ? `已确认 v${map.active_revision}`
                          : `草稿 v${map.revision}`}
                    </span>
                    <time>{formatTime(map.updated_at)}</time>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {creating && novelId != null ? (
        <MapGenerateDialog
          novelId={novelId}
          onClose={() => setCreating(false)}
          onDone={(detail) => {
            setCreating(false);
            navigate(`/novels/${novelId}/artworks/${detail.id}`);
          }}
        />
      ) : null}
    </section>
  );
}
