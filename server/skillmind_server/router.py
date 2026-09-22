from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from skillmind_server.adapters import Candidate, ProviderError
from skillmind_server.config_file import AiConfig

PROFILE_CAPABILITY = {
    "video": "video",
    "transcription": "transcription",
    "lecture": "text",
    "translation": "translation",
    "quiz": "text",
    "chat": "chat",
    "embedding": "embedding",
}


@dataclass
class AttemptLog:
    connection_slug: str
    provider: str
    key_alias: str
    quota_group: str | None
    model_id: str
    outcome: str
    http_status: int | None = None
    retry_after: datetime | None = None
    detail: str | None = None


@dataclass
class RouterResult:
    text: str | None
    outcome: str
    winner: Candidate | None
    attempts: list[AttemptLog] = field(default_factory=list)


def candidates_for_profile(
    config: AiConfig,
    secrets: dict[str, str],
    profile: str,
    catalog: list[dict[str, Any]] | None = None,
) -> list[Candidate]:
    order = config.profiles.get(profile)
    if not order:
        return []
    needed = PROFILE_CAPABILITY.get(profile)
    catalog = catalog or []
    result: list[Candidate] = []
    for slug in order:
        connection = config.connection_by_slug(slug)
        if connection is None:
            continue
        models = _models_for_connection(connection, catalog, needed)
        if not models:
            continue
        for alias in connection.key_aliases:
            secret = (secrets.get(alias) or "").strip()
            if not secret:
                continue
            for model_id in models:
                result.append(
                    Candidate(
                        connection_slug=connection.slug,
                        provider=connection.provider,
                        base_url=connection.base_url,
                        key_alias=alias,
                        api_key=secret,
                        quota_group=connection.quota_group,
                        model_id=model_id,
                    )
                )
    return result


def run_text(
    config: AiConfig,
    secrets: dict[str, str],
    profile: str,
    prompt: str,
    caller: Callable[[Candidate, str], str],
    catalog: list[dict[str, Any]] | None = None,
) -> RouterResult:
    attempts: list[AttemptLog] = []
    skipped_quota: set[str] = set()
    skipped_keys: set[str] = set()
    skipped_models: set[tuple[str, str]] = set()
    for candidate in candidates_for_profile(config, secrets, profile, catalog):
        if candidate.quota_group and candidate.quota_group in skipped_quota:
            continue
        if candidate.key_alias in skipped_keys:
            continue
        if (candidate.key_alias, candidate.model_id) in skipped_models:
            continue
        for try_number in (1, 2):
            try:
                text = caller(candidate, prompt)
                attempts.append(_log(candidate, "succeeded"))
                return RouterResult(text, "succeeded", candidate, attempts)
            except ProviderError as error:
                attempts.append(_log(candidate, error.outcome, error))
                if error.outcome in {"invalid_input", "refused"}:
                    return RouterResult(None, error.outcome, None, attempts)
                if error.outcome == "transient_error" and try_number == 1:
                    continue
                if error.outcome == "rate_limited":
                    if candidate.quota_group:
                        skipped_quota.add(candidate.quota_group)
                    else:
                        skipped_keys.add(candidate.key_alias)
                elif error.outcome == "invalid_key":
                    skipped_keys.add(candidate.key_alias)
                elif error.outcome == "unavailable_model":
                    skipped_models.add((candidate.key_alias, candidate.model_id))
                break
    return RouterResult(None, "waiting_provider", None, attempts)


def public_candidate(candidate: Candidate) -> dict[str, str | None]:
    return {
        "connection_slug": candidate.connection_slug,
        "provider": candidate.provider,
        "key_alias": candidate.key_alias,
        "quota_group": candidate.quota_group,
        "model_id": candidate.model_id,
    }


def public_attempt(attempt: AttemptLog) -> dict[str, Any]:
    return {
        "connection_slug": attempt.connection_slug,
        "provider": attempt.provider,
        "key_alias": attempt.key_alias,
        "quota_group": attempt.quota_group,
        "model_id": attempt.model_id,
        "outcome": attempt.outcome,
        "http_status": attempt.http_status,
        "retry_after": attempt.retry_after.isoformat() if attempt.retry_after else None,
        "detail": attempt.detail,
    }


def _models_for_connection(connection, catalog: list[dict[str, Any]], needed: str | None) -> list[str]:
    rows = [
        row
        for row in catalog
        if row.get("connection_slug") == connection.slug and row.get("availability") != "unavailable"
    ]
    if rows:
        models: list[str] = []
        for row in rows:
            capabilities = row.get("capabilities") or []
            if needed and capabilities and needed not in capabilities:
                continue
            model_id = str(row.get("model_id") or "").strip()
            if model_id and model_id not in models:
                models.append(model_id)
        if models:
            return models
    return list(connection.models)


def _log(candidate: Candidate, outcome: str, error: Any | None = None) -> AttemptLog:
    return AttemptLog(
        connection_slug=candidate.connection_slug,
        provider=candidate.provider,
        key_alias=candidate.key_alias,
        quota_group=candidate.quota_group,
        model_id=candidate.model_id,
        outcome=outcome,
        http_status=getattr(error, "http_status", None),
        retry_after=getattr(error, "retry_after", None),
        detail=getattr(error, "detail", None),
    )
