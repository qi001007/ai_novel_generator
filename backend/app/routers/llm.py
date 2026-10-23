from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.db import get_session
from app.services.llm import LLMClient, get_llm_client, resolve_routing


router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/status")
def llm_status(
    llm: LLMClient = Depends(get_llm_client),
    session: Session = Depends(get_session),
) -> dict:
    routing = resolve_routing(session)
    return {
        "provider": llm.settings.provider,
        "configured": routing.is_configured,
        "models": {
            task_type: bool(model)
            for task_type, model in llm.settings.models.items()
        },
        # Concrete model names the chat pill is allowed to send back as `model`.
        "available_models": sorted(llm.settings.configured_models),
    }
