from fastapi import FastAPI

app = FastAPI(title="AI Novel Generator")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
