import { useEffect, useState } from "react";
import { ArrowLeft, Moon, Settings, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { useWorkbench } from "../store/workbench";

type LlmStatus = {
  provider: string;
  configured: boolean;
  models: Record<string, boolean>;
  available_models: string[];
};

const TASKS: Array<[string, string]> = [
  ["draft", "正文生成"],
  ["review", "审稿"],
  ["summary", "章摘要"],
  ["chat", "对话"],
];

const PROVIDERS: Record<string, string> = {
  openai_compatible: "OpenAI 兼容接口",
};

export default function PreferencesPage() {
  const navigate = useNavigate();
  const theme = useWorkbench((state) => state.theme);
  const toggleTheme = useWorkbench((state) => state.toggleTheme);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.get<LlmStatus>("/api/llm/status").then((data) => {
      if (active) setStatus(data);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });
    return () => {
      active = false;
    };
  }, []);

  function pickTheme(next: "light" | "dark") {
    if (next !== theme) toggleTheme();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>墨阁</strong>
          <span>设置</span>
        </div>
        <div className="topbar-actions">
          <button type="button" aria-label="返回书架" title="返回书架" onClick={() => navigate("/")}>
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={theme === "dark" ? "切到浅色" : "切到深色"}
            onClick={() => pickTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="prefs-main">
        <section className="page-panel">
          <h2>
            <Settings size={14} aria-hidden="true" /> 模型接入
          </h2>
          {error ? <p className="prefs-error">读不到模型状态：{error}</p> : null}
          {!status && !error ? <p className="prefs-muted">正在读取后端配置……</p> : null}
          {status ? (
            <>
              <dl className="prefs-facts">
                <div>
                  <dt>服务商</dt>
                  <dd>{PROVIDERS[status.provider] ?? status.provider}</dd>
                </div>
                <div>
                  <dt>可用性</dt>
                  <dd>
                    <span className={status.configured ? "prefs-badge ok" : "prefs-badge warn"}>
                      {status.configured ? "已配置" : "未配置"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>可用模型</dt>
                  <dd>{status.available_models.length > 0 ? status.available_models.join("、") : "—"}</dd>
                </div>
              </dl>
              <table className="prefs-table">
                <thead>
                  <tr>
                    <th>用途</th>
                    <th>是否已配模型</th>
                  </tr>
                </thead>
                <tbody>
                  {TASKS.map(([key, label]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{status.models[key] ? "已配置" : "未配置"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="prefs-muted">
                这些值目前由后端进程的 backend/.env 决定，改完需重启后端。页面上改配置的接口还没有，
                所以我这里只如实显示现状，不放不能用的输入框。
              </p>
            </>
          ) : null}
        </section>

        <section className="page-panel">
          <h2>外观</h2>
          <div className="theme-choice" role="radiogroup" aria-label="主题">
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              onClick={() => pickTheme("light")}
            >
              浅色
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              onClick={() => pickTheme("dark")}
            >
              深色
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
