from __future__ import annotations

from skillmind_server.adapters import ProviderError
from skillmind_server.config_file import load_ai_config
from skillmind_server.router import candidates_for_profile, run_text
from skillmind_server.settings import Settings

CONFIG = load_ai_config(Settings(_env_file=None).config_path)
SECRETS = {
    "GEMINI_API_KEY_1": "gemini-secret",
    "LITELLM_API_KEY_1": "litellm-secret",
    "OPENAI_API_KEY_1": "openai-secret",
}


def _ids(profile: str, secrets: dict[str, str] | None = None):
    return [
        (item.provider, item.key_alias, item.model_id)
        for item in candidates_for_profile(CONFIG, secrets or SECRETS, profile)
    ]


def test_yaml_models_and_lecture_order():
    assert _ids("lecture") == [
        ("litellm", "LITELLM_API_KEY_1", "qwen-chat"),
        ("gemini", "GEMINI_API_KEY_1", "gemini-3.5-flash"),
        ("gemini", "GEMINI_API_KEY_1", "gemini-3.5-flash-lite"),
        ("gemini", "GEMINI_API_KEY_1", "gemini-2.5-flash"),
        ("openai", "OPENAI_API_KEY_1", "gpt-4.1-mini"),
        ("openai", "OPENAI_API_KEY_1", "gpt-4o-mini"),
    ]
    assert _ids("transcription")[0] == ("litellm", "LITELLM_API_KEY_1", "whisper-1")
    assert _ids("embedding") == [("litellm", "LITELLM_API_KEY_1", "qwen-embed")]


def test_missing_gemini_key_starts_at_litellm():
    secrets = {**SECRETS, "GEMINI_API_KEY_1": ""}
    assert _ids("lecture", secrets)[0] == ("litellm", "LITELLM_API_KEY_1", "qwen-chat")


def test_gemini_quota_skips_remaining_gemini_models():
    def caller(candidate, _prompt):
        if candidate.provider == "litellm":
            raise ProviderError("rate_limited", http_status=429)
        return f"ok:{candidate.provider}"

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert result.outcome == "succeeded"
    assert result.winner is not None
    assert result.winner.provider == "gemini"
    assert [item.provider for item in result.attempts] == ["litellm", "gemini"]
    assert result.attempts[0].outcome == "rate_limited"


def test_invalid_key_skips_all_models_for_that_alias():
    def caller(candidate, _prompt):
        if candidate.provider == "litellm":
            raise ProviderError("invalid_key", http_status=401)
        return "ok"

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert result.winner is not None
    assert result.winner.provider == "gemini"
    assert [item.model_id for item in result.attempts] == ["qwen-chat", "gemini-3.5-flash"]


def test_unavailable_model_tries_next_model():
    def caller(candidate, _prompt):
        if candidate.model_id == "qwen-chat":
            raise ProviderError("unavailable_model", http_status=404)
        return "ok"

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert result.winner is not None
    assert result.winner.model_id == "gemini-3.5-flash"
    assert result.attempts[0].outcome == "unavailable_model"


def test_refused_content_does_not_fallback():
    def caller(_candidate, _prompt):
        raise ProviderError("refused", http_status=400, detail="safety")

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert result.outcome == "refused"
    assert result.winner is None
    assert len(result.attempts) == 1


def test_invalid_input_does_not_fallback():
    def caller(_candidate, _prompt):
        raise ProviderError("invalid_input", http_status=400)

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert result.outcome == "invalid_input"
    assert len(result.attempts) == 1


def test_transient_error_retries_once_then_moves_on():
    calls: list[str] = []

    def caller(candidate, _prompt):
        calls.append(candidate.model_id)
        if candidate.model_id == "qwen-chat":
            raise ProviderError("transient_error", retryable_once=True)
        return "ok"

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert calls.count("qwen-chat") == 2
    assert result.winner is not None
    assert result.winner.model_id == "gemini-3.5-flash"


def test_all_providers_exhausted_wait():
    def caller(_candidate, _prompt):
        raise ProviderError("rate_limited", http_status=429)

    result = run_text(CONFIG, SECRETS, "lecture", "hi", caller)
    assert result.outcome == "waiting_provider"
    assert [item.provider for item in result.attempts] == ["litellm", "gemini", "openai"]
