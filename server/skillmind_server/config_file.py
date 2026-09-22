from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from skillmind_server.errors import ApiError

ALLOWED_PROVIDERS = {"gemini", "openai", "xai", "huggingface", "litellm"}
PROFILES = ("video", "transcription", "lecture", "translation", "quiz", "chat", "embedding")
KEY_ALIAS_RE = re.compile(
    r"^(GEMINI_API_KEY|OPENAI_API_KEY|XAI_API_KEY|HF_TOKEN|LITELLM_API_KEY)_[1-9][0-9]*$"
)
SECRET_FIELD_RE = re.compile(
    r"(secret|password|credential|authorization|api.?key|access.?token|refresh.?token|^token$|^headers$)",
    re.IGNORECASE,
)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


@dataclass(frozen=True)
class Connection:
    slug: str
    provider: str
    base_url: str
    key_aliases: tuple[str, ...]
    quota_group: str | None
    models: tuple[str, ...]


@dataclass(frozen=True)
class AiConfig:
    connections: tuple[Connection, ...]
    profiles: dict[str, tuple[str, ...]]
    file_sha256: str
    raw: dict[str, Any]

    def connection_by_slug(self, slug: str) -> Connection | None:
        return next((item for item in self.connections if item.slug == slug), None)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bind_litellm_url(config: AiConfig, base_url: str) -> AiConfig:
    url = (base_url or "").strip().rstrip("/")
    if not url:
        return config
    from dataclasses import replace

    connections = tuple(replace(item, base_url=url) if item.provider == "litellm" else item for item in config.connections)
    return replace(config, connections=connections)


def load_ai_config(path: str | Path) -> AiConfig:
    config_path = Path(path)
    if not config_path.is_file():
        raise ApiError(500, "AI_CONFIG_REQUIRED", "config/ai.yaml is missing")
    payload = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    return parse_ai_config(payload, file_sha256(config_path))


def parse_ai_config(payload: Any, digest: str = "") -> AiConfig:
    if not isinstance(payload, dict):
        raise ApiError(500, "AI_INVALID_INPUT", "AI config must be a mapping")
    _assert_secret_free(payload)
    connections = tuple(_parse_connection(item) for item in payload.get("connections") or [])
    if not connections:
        raise ApiError(500, "AI_INVALID_INPUT", "AI config needs at least one connection")
    slugs = [item.slug for item in connections]
    if len(slugs) != len(set(slugs)):
        raise ApiError(500, "AI_INVALID_INPUT", "connection slugs must be unique")
    profiles: dict[str, tuple[str, ...]] = {}
    raw_profiles = payload.get("profiles") or {}
    if not isinstance(raw_profiles, dict):
        raise ApiError(500, "AI_INVALID_INPUT", "profiles must be a mapping")
    for name in PROFILES:
        entry = raw_profiles.get(name) or {}
        order = entry.get("order") if isinstance(entry, dict) else entry
        if not isinstance(order, list) or not order:
            raise ApiError(500, "AI_INVALID_INPUT", f"profile {name} needs a non-empty order")
        for slug in order:
            if slug not in slugs:
                raise ApiError(500, "AI_INVALID_INPUT", f"profile {name} references unknown {slug}")
        profiles[name] = tuple(str(slug) for slug in order)
    return AiConfig(
        connections=connections,
        profiles=profiles,
        file_sha256=digest or ("0" * 64),
        raw=payload,
    )


def _parse_connection(item: Any) -> Connection:
    if not isinstance(item, dict):
        raise ApiError(500, "AI_INVALID_INPUT", "connection must be a mapping")
    slug = str(item.get("slug") or "")
    provider = str(item.get("provider") or "")
    base_url = str(item.get("base_url") or "").rstrip("/")
    aliases = item.get("key_aliases") or []
    models = item.get("models") or []
    quota_group = item.get("quota_group")
    if not SLUG_RE.match(slug):
        raise ApiError(500, "AI_INVALID_INPUT", f"invalid connection slug {slug}")
    if provider not in ALLOWED_PROVIDERS:
        raise ApiError(500, "AI_INVALID_INPUT", f"unsupported provider {provider}")
    if not base_url.startswith(("http://", "https://")) or "@" in base_url:
        raise ApiError(500, "AI_INVALID_INPUT", f"invalid base_url for {slug}")
    if not isinstance(aliases, list) or not aliases:
        raise ApiError(500, "AI_INVALID_INPUT", f"{slug} needs key_aliases")
    for alias in aliases:
        if not isinstance(alias, str) or not KEY_ALIAS_RE.match(alias):
            raise ApiError(500, "AI_INVALID_INPUT", f"invalid key alias {alias}")
    if not isinstance(models, list):
        raise ApiError(500, "AI_INVALID_INPUT", f"{slug} models must be a list")
    parsed_models = tuple(str(model).strip() for model in models if str(model).strip())
    return Connection(
        slug=slug,
        provider=provider,
        base_url=base_url,
        key_aliases=tuple(str(alias) for alias in aliases),
        quota_group=str(quota_group) if quota_group else None,
        models=parsed_models,
    )


def _assert_secret_free(value: Any, key: str | None = None) -> None:
    if key and SECRET_FIELD_RE.search(key) and key != "key_aliases":
        raise ApiError(500, "AI_INVALID_INPUT", f"secret field {key} is not allowed in config/ai.yaml")
    if isinstance(value, dict):
        for child_key, child in value.items():
            _assert_secret_free(child, str(child_key))
        return
    if isinstance(value, list):
        for child in value:
            _assert_secret_free(child, key)
        return
    if isinstance(value, str) and re.search(r"(^Bearer\s|^sk-[A-Za-z0-9_-]{10,}|^hf_[A-Za-z0-9]{10,}|https?://[^/]*@)", value):
        raise ApiError(500, "AI_INVALID_INPUT", "config/ai.yaml looks like it contains a secret")
