from fastapi import FastAPI

from app.routers import (
    agent_runs,
    chapters,
    characters,
    chat,
    commands,
    config,
    context_preview,
    events,
    workflows,
    workflow_runs,
    backups,
    documents,
    export,
    feedback,
    foreshadows,
    generation_runs,
    images,
    knowledge,
    llm,
    maps,
    novels,
    planning,
    reviews,
    settings,
    summaries,
    workspace,
)

app = FastAPI(title="AI Novel Generator")

app.include_router(novels.router, prefix="/api")
app.include_router(agent_runs.router, prefix="/api")
app.include_router(planning.router, prefix="/api")
app.include_router(chapters.router, prefix="/api")
app.include_router(summaries.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
app.include_router(generation_runs.router, prefix="/api")
app.include_router(images.router, prefix="/api")
app.include_router(maps.router, prefix="/api")
app.include_router(llm.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(knowledge.router, prefix="/api")
app.include_router(foreshadows.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(export.settings_router, prefix="/api")
app.include_router(backups.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(workflows.router, prefix="/api")
app.include_router(workflow_runs.router, prefix="/api")
app.include_router(commands.router, prefix="/api")
app.include_router(context_preview.router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(events.router, prefix="/api")


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
