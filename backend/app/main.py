from fastapi import FastAPI

from app.routers import chapters, novels, planning

app = FastAPI(title="AI Novel Generator")

app.include_router(novels.router, prefix="/api")
app.include_router(planning.router, prefix="/api")
app.include_router(chapters.router, prefix="/api")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
