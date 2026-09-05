import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { useWorkbench } from "../store/workbench";

type LlmProvider = {
  id: string;
  name: string;
  provider: string;
  api_base_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  is_default: boolean;
};

type LlmConfig = {
  provider: string;
  api_base_url: string;
  timeout: number;
  models: Record<string, string>;
  api_key_masked: string;
  api_key_set: boolean;
  configured: boolean;
  providers: LlmProvider[];
  routes: Record<string, string>;
  tasks: string[];
};

/** An editable row in the provider list. `api_key` holds only what the owner typed;
 *  an empty string means "leave the stored one alone", which is also what the server
 *  does with the **** echo. */
type ProviderDraft = {
  id: string;
  name: string;
  provider: string;
  api_base_url: string;
  api_key: string;
  timeout: string;
  keyMask: string;
  isDefault: boolean;
};

type TestResult = { ok: boolean; detail: string };

const TASKS: Array<[string, string]> = [
  ["draft", "正文生成"],
  ["review", "审稿"],
  ["summary", "章摘要"],
  ["chat", "对话"],
  // 第十九批批注 2: the slot is reserved with the same shape as the others. Nothing
  // calls it yet, so the row says 未启用 instead of pretending a button works.
  ["image", "生图（未启用）"],
];

type GroupKey = "llm" | "appearance";

/** A new row gets an id the owner never sees or types; it is only the join key between
 *  a provider and the tasks that point at it. */
function nextProviderId(existing: ProviderDraft[]): string {
  let n = existing.length + 1;
  while (existing.some((item) => item.id === `p${n}`)) n += 1;
  return `p${n}`;
}

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
  const [group, setGroup] = useState<GroupKey>("llm");
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  /* One place that puts a freshly read config into the form, used by the first load and
     by every save - the two used to drift (a save left a removed provider on screen). */
  function applyConfig(data: LlmConfig) {
    setConfig(data);
    setBaseUrl(data.api_base_url);
    setTimeout_(String(data.timeout));
    setModels(data.models);
    setRoutes(data.routes);
    setProviders(
      data.providers
        .filter((item) => !item.is_default)
        .map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          api_base_url: item.api_base_url,
          // never echoed back; blank means keep the stored one
          api_key: "",
          timeout: "",
          keyMask: item.api_key_masked,
          isDefault: false,
        })),
    );
  }

  useEffect(() => {
    let active = true;
    api.get<LlmConfig>("/api/config/llm").then((data) => {
      if (!active) return;
      applyConfig(data);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // these four still describe the 默认 provider
        api_base_url: baseUrl,
        // Blank means "leave the stored key alone"; the server also ignores a mask echo.
        api_key: apiKey,
        timeout: Number(timeout),
        models,
        providers: providers.map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          api_base_url: item.api_base_url,
          api_key: item.api_key,
          timeout: item.timeout === "" ? null : Number(item.timeout),
        })),
        routes,
      })
      .then((data) => {
        applyConfig(data);
        setApiKey("");
        setNotice("已保存，后端立即生效，不需要重启");
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "保存失败"),
      )
      .finally(() => setBusy(false));
  }

  function testProvider(providerId: string, name: string) {
    setTestResults((prev) => ({ ...prev, [providerId]: "测试中…" }));
    return api
      .post<TestResult>("/api/config/llm/test", { provider_id: providerId })
      .then((data) => setTestResults((prev) => ({ ...prev, [providerId]: data.detail })))
      .catch((cause: Error) =>
        setTestResults((prev) => ({ ...prev, [providerId]: `「${name || providerId}」${cause.message}` })),
      );
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

  /* 设置页结构（主人点了三次的那条）：一个设置项 = 左边列表的一条 + 右边一块面板。
     以后加「色系 / 代码配色 / 字体」就是往这张表里添一项，不用动布局。 */
  const groups: { key: GroupKey; label: string; body: ReactNode }[] = [
    {
      key: "llm",
      label: "模型接入",
      body: (
        <>
          {!config && !error ? <p className="prefs-muted">正在读取后端配置……</p> : null}
        {config ? (
          <>
            {/* These three fields are the 默认供应商 - the same quartet the legacy
                single-provider keys always described. The rows below are the extras. */}
            <p className="prefs-group-title">默认供应商</p>
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
            {/* 第十九批批注 2：「同时保存不同的供应商」+「正文/审稿/摘要用不同供应商的不同模型」。
                供应商是一张列表，任务路由每一行选一个供应商再填模型名；
                生图只是这张表里多一行任务，不是另一套代码。 */}
            <div className="prefs-providers">
              <p className="prefs-group-title">其他供应商</p>
              {providers.length === 0 ? <p className="prefs-muted">还没有第二个供应商</p> : null}
              {providers.map((item, index) => (
                <div className="prefs-provider-row" key={item.id}>
                  <input
                    className="prefs-provider-name"
                    value={item.name}
                    placeholder="名称"
                    aria-label={`供应商 ${index + 1} 名称`}
                    onChange={(event) =>
                      setProviders((prev) =>
                        prev.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)),
                      )
                    }
                  />
                  <input
                    className="prefs-provider-url"
                    value={item.api_base_url}
                    placeholder="https://api.example.com/v1"
                    aria-label={`供应商 ${index + 1} Base URL`}
                    onChange={(event) =>
                      setProviders((prev) =>
                        prev.map((row, at) => (at === index ? { ...row, api_base_url: event.target.value } : row)),
                      )
                    }
                  />
                  <input
                    type="password"
                    className="prefs-provider-key"
                    value={item.api_key}
                    placeholder={item.keyMask ? `已保存 ${item.keyMask}，留空则不修改` : "API Key"}
                    aria-label={`供应商 ${index + 1} API Key`}
                    autoComplete="off"
                    onChange={(event) =>
                      setProviders((prev) =>
                        prev.map((row, at) => (at === index ? { ...row, api_key: event.target.value } : row)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="prefs-provider-test"
                    onClick={() => void testProvider(item.id, item.name)}
                    disabled={busy}
                  >
                    测试
                  </button>
                  <button
                    type="button"
                    className="prefs-provider-drop"
                    aria-label={`移除供应商 ${item.name || item.id}`}
                    onClick={() => {
                      setProviders((prev) => prev.filter((row) => row.id !== item.id));
                      // a task still pointing here would be refused on save; send it home now
                      setRoutes((prev) => {
                        const next: Record<string, string> = {};
                        for (const [task, pid] of Object.entries(prev)) {
                          next[task] = pid === item.id ? "default" : pid;
                        }
                        return next;
                      });
                    }}
                  >
                    <X size={12} />
                  </button>
                  {testResults[item.id] ? <p className="prefs-provider-result">{testResults[item.id]}</p> : null}
                </div>
              ))}
              <button
                type="button"
                className="prefs-provider-add"
                onClick={() =>
                  setProviders((prev) => [
                    ...prev,
                    {
                      id: nextProviderId(prev),
                      name: "",
                      provider: "openai_compatible",
                      api_base_url: "",
                      api_key: "",
                      timeout: "",
                      keyMask: "",
                      isDefault: false,
                    },
                  ])
                }
              >
                添加供应商
              </button>
            </div>

            <p className="prefs-group-title">任务路由</p>
            <div className="prefs-routes">
              {TASKS.map(([key, label]) => (
                <div className="prefs-route-row" key={key}>
                  <span className="prefs-route-task">{label}</span>
                  <select
                    className="prefs-route-provider"
                    value={routes[key] ?? "default"}
                    aria-label={`${label}使用的供应商`}
                    onChange={(event) => setRoutes({ ...routes, [key]: event.target.value })}
                  >
                    <option value="default">默认</option>
                    {providers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name || item.id}
                      </option>
                    ))}
                  </select>
                  <input
                    className="prefs-route-model"
                    value={models[key] ?? ""}
                    placeholder={key === "image" ? "未启用" : ""}
                    aria-label={label + "模型"}
                    onChange={(event) => setModels({ ...models, [key]: event.target.value })}
                  />
                </div>
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
        </>
      ),
    },
    {
      key: "appearance",
      label: "外观",
      body: (
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

      ),
    },
  ];
  const activeGroup = groups.find((item) => item.key === group) ?? groups[0];

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
        {/* 列表 + 入口：左列是设置项，右边只有当前这一项。 */}
        <nav className="prefs-nav" role="tablist" aria-label="设置项">
          {groups.map((item) => (
            <button
              key={item.key}
              id={`prefs-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={item.key === group}
              onClick={() => setGroup(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {/* No heading in here: the row on the left already says which group this is, and
            repeating it is the §0.7 条六 the owner keeps having to point at. The panel is
            labelled by that row instead, so a reader still hears it. */}
        <section
          className="page-panel prefs-panel"
          role="tabpanel"
          aria-labelledby={`prefs-tab-${activeGroup.key}`}
        >
          {activeGroup.body}
        </section>
      </main>
    </div>
  );
}
