from pathlib import Path

from app.services import llm as llm_module
from app.services.llm import LLMSettings


def test_settings_load_local_env_file(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join([
            "NOVEL_LLM_PROVIDER=opencode",
            "NOVEL_LLM_API_BASE_URL=https://llm.example.com/v1",
            "NOVEL_LLM_API_KEY=file-key",
            "NOVEL_LLM_DRAFT_MODEL=file-draft",
        ]),
        encoding="utf-8",
    )
    monkeypatch.setattr(llm_module, "DOTENV_PATH", env_file)
    for name in [
        "NOVEL_LLM_PROVIDER",
        "NOVEL_LLM_API_BASE_URL",
        "NOVEL_LLM_API_KEY",
        "NOVEL_LLM_DRAFT_MODEL",
    ]:
        monkeypatch.delenv(name, raising=False)

    settings = LLMSettings.from_env()

    assert settings.provider == "opencode"
    assert settings.api_base_url == "https://llm.example.com/v1"
    assert settings.api_key == "file-key"
    assert settings.models["draft"] == "file-draft"
