import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { useWorkbench } from "../store/workbench";

type LlmConfig = {
  provider: string;
  api_base_url: string;
  timeout: number;
  models: Record<string, string>;
  api_key_masked: string;
  api_key_set: boolean;
  configured: boolean;
};

type TestResult = { ok: boolean; detail: string };

const TASKS: Array<[string, string]> = [
  ["draft", "正文生成"],
  ["review", "审稿"],
  ["summary", "章摘要"],
  ["chat", "对话"],
];

export default function PreferencesPage() {
  const navigate = useNavigate();
  // React Router keeps the entry index in history state; 0 means the reader
  // arrived here directly and there is nothing in-app to go back to.
  const historyDepth =
    (window.history.state as { idx?: number } | null | undefined)?.idx ?? 0;
  const theme = useWorkbench((state) => state.theme);
  const toggleTheme = useWorkbench((state) => state.toggleTheme);
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [timeout, setTimeout_] = useState("120");
  const [models, setModels] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<LlmConfig>("/api/config/llm").then((data) => {
      if (!active) return;
      setConfig(data);
      setBaseUrl(data.api_base_url);
      setTimeout_(String(data.timeout));
      setModels(data.models);
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

  function save() {
    if (!config) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    api
      .put<LlmConfig>("/api/config/llm", {
        api_base_url: baseUrl,
        // Blank means "leave the stored key alone"; the server also ignores a mask echo.
        api_key: apiKey,
        timeout: Number(timeout),
        models,
      })
      .then((data) => {
        setConfig(data);
        setBaseUrl(data.api_base_url);
        setTimeout_(String(data.timeout));
        setModels(data.models);
        setApiKey("");
        setNotice("已保存，后端立即生效，不需要重启。");
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "保存失败"),
      )
      .finally(() => setBusy(false));
  }

  function test() {
    setBusy(true);
    setError(null);
    setNotice(null);
    api
      .post<TestResult>("/api/config/llm/test", {})
      .then((result) => {
        setNotice(result.detail);
        if (!result.ok) setError(result.detail);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "测试失败"),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>墨阁</strong>
          <span>· 偏好设置</span>
        </div>
        <div className="topbar-actions">
          {/* 批注 1: the second button here duplicated the 外观 switch below and
              crowded out the one control this bar actually needs. */}
          <button
            type="button"
            aria-label="返回上一页"
            title="返回上一页"
            // 批注 2: it always went to the shelf, so opening settings from a book
            // threw the reader out of the workbench. Back means back.
            onClick={() => (historyDepth > 0 ? navigate(-1) : navigate("/"))}
          >
            <ArrowLeft size={16} />
          </button>
        </div>
      </header>

      <main className="prefs-main">
        <section className="page-panel">
          <h2>模型接入</h2>
          {!config && !error ? <p className="prefs-muted">正在读取后端配置……</p> : null}
          {config ? (
            <>
              <label className="prefs-field">
                Base URL
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.example.com/v1"
                  aria-label="Base URL"
                />
              </label>
              <label className="prefs-field">
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    config.api_key_set
                      ? "已保存 " + config.api_key_masked + "，留空则不修改"
                      : "尚未配置"
                  }
                  aria-label="API Key"
                  autoComplete="off"
                />
              </label>
              <label className="prefs-field prefs-field-narrow">
                超时（秒）
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={timeout}
                  onChange={(event) => setTimeout_(event.target.value)}
                  aria-label="超时秒数"
                />
              </label>
              <div className="prefs-models">
                {TASKS.map(([key, label]) => (
                  <label className="prefs-field" key={key}>
                    {label}
                    <input
                      value={models[key] ?? ""}
                      onChange={(event) =>
                        setModels({ ...models, [key]: event.target.value })
                      }
                      aria-label={label + "模型"}
                    />
                  </label>
                ))}
              </div>
              <p className="prefs-state">
                <span className={config.configured ? "prefs-badge ok" : "prefs-badge warn"}>
                  {config.configured ? "已配置" : "未配置"}
                </span>
                <span>服务商 {config.provider}</span>
              </p>
              {notice ? <p className="prefs-notice">{notice}</p> : null}
              {error ? <p className="prefs-error">{error}</p> : null}
              <div className="prefs-actions">
                <button type="button" onClick={test} disabled={busy}>
                  测试连接
                </button>
                <button type="button" className="primary" onClick={save} disabled={busy}>
                  保存
                </button>
              </div>
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
