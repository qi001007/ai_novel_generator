from fastapi import FastAPI

from app.routers import (
    chapters,
    feedback,
    generation_runs,
    novels,
    planning,
    reviews,
    summaries,
)

app = FastAPI(title="AI Novel Generator")

app.include_router(novels.router, prefix="/api")
app.include_router(planning.router, prefix="/api")
app.include_router(chapters.router, prefix="/api")
app.include_router(summaries.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
app.include_router(generation_runs.router, prefix="/api")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
