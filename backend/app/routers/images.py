"""Thin HTTP boundary for the configured image-generation provider."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel

from app.services.llm import LLMClient, LLMError, get_llm_client


router = APIRouter(prefix="/images", tags=["images"])


class ImageGenerationIn(SQLModel):
    prompt: str
    negative_prompt: str | None = None
    size: str = "1024x1024"
    prompt_extend: bool = True


class ImageGenerationOut(SQLModel):
    model: str
    urls: list[str]
    usage: dict
    request_id: str
    expires_in_hours: int = 24


@router.post("/generations", response_model=ImageGenerationOut)
def generate_image(
    payload: ImageGenerationIn,
    llm: LLMClient = Depends(get_llm_client),
) -> ImageGenerationOut:
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="生图提示词不能为空")
    if len(prompt) > 12_000:
        raise HTTPException(status_code=422, detail="生图提示词过长")
    if payload.size not in {"1024x1024", "1024x1536", "1536x1024", "2048x2048"}:
        raise HTTPException(status_code=422, detail="暂只支持 1K、竖幅、横幅或 2K 预设尺寸")
    try:
        result = llm.generate_image(
            prompt,
            size=payload.size,
            negative_prompt=payload.negative_prompt,
            prompt_extend=payload.prompt_extend,
        )
    except LLMError as cause:
        raise HTTPException(status_code=502, detail=str(cause)) from cause
    return ImageGenerationOut(
        model=result.model,
        urls=result.urls,
        usage=result.usage,
        request_id=result.request_id,
    )
