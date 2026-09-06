from fastapi import FastAPI

from app.routers import (
    chapters,
    characters,
    chat,
    config,
    documents,
    export,
    feedback,
    generation_runs,
    llm,
    novels,
    planning,
    reviews,
    settings,
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
app.include_router(llm.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(config.router, prefix="/api")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
