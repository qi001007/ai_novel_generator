from fastapi import FastAPI

from app.routers import novels

app = FastAPI(title="AI Novel Generator")

app.include_router(novels.router, prefix="/api")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
