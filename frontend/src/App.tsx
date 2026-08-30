import { useEffect, useState } from "react";

type HealthState = "loading" | "ok" | "error";

export default function App() {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    let active = true;

    fetch("/api/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("health check failed");
        }
        setHealth("ok");
      })
      .catch(() => {
        if (active) {
          setHealth("error");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page">
      <section className="panel">
        <h1>AI 小说生成工作台</h1>
        <p>项目骨架已就绪，后续将在这里进入章纲、生成与审稿流水线。</p>
        <p className={health === "ok" ? "status-ok" : "status-error"}>
          后端状态：
          {health === "loading" ? "检查中" : health === "ok" ? "正常" : "未连接"}
        </p>
      </section>
    </main>
  );
}
