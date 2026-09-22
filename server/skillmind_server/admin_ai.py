from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from skillmind_server.adapters import Candidate, HttpCaller
from skillmind_server.config_file import AiConfig, bind_litellm_url, load_ai_config
from skillmind_server.data import DataAccess
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.providers import list_remote_models, provider_status
from skillmind_server.router import PROFILE_CAPABILITY, candidates_for_profile, public_attempt, public_candidate, run_text
from skillmind_server.settings import Settings

DEFAULT_PROBE_PROMPT = "Reply with the single word OK."
MAX_PROBE_CHARS = 500


class AdminAiService:
    def __init__(
        self,
        settings: Settings,
        data: DataAccess,
        caller: Callable[[Candidate, str], str] | None = None,
    ) -> None:
        self.settings = settings
        self.data = data
        self.caller = caller or (lambda candidate, prompt: HttpCaller().complete(candidate, prompt))

    def require_admin(self, user: AuthUser) -> None:
        if not self.data.is_admin(user.token):
            raise ApiError(403, "AI_ACCESS_DENIED")

    def load_file(self) -> AiConfig:
        return bind_litellm_url(load_ai_config(self.settings.config_path), self.settings.litellm_base_url)

    def overview(self, user: AuthUser) -> dict[str, Any]:
        self.require_admin(user)
        config = self.load_file()
        secrets = self.settings.secret_map()
        catalog = self.data.list_catalog()
        runtime = self.data.get_runtime()
        versions = self.data.list_config_versions()
        active_hash = next(
            (item.get("file_sha256") for item in versions if item.get("id") == runtime.get("active_config_id")),
            None,
        )
        connections = []
        for connection in config.connections:
            connections.append(
                {
                    "slug": connection.slug,
                    "provider": connection.provider,
                    "base_url": connection.base_url,
                    "key_aliases": [
                        {"alias": alias, "present": bool((secrets.get(alias) or "").strip())}
                        for alias in connection.key_aliases
                    ],
                    "quota_group": connection.quota_group,
                    "models": list(connection.models),
                }
            )
        profiles = {
            name: [public_candidate(item) for item in candidates_for_profile(config, secrets, name, catalog)]
            for name in config.profiles
        }
        dumped = str(
            {
                "connections": connections,
                "profiles": profiles,
                "catalog": catalog,
                "jobs": self.data.list_recent_jobs(),
                "attempts": self.data.list_recent_attempts(),
            }
        )
        if any(secret and secret in dumped for secret in secrets.values() if secret):
            raise ApiError(500, "AI_INVALID_INPUT", "refusing to serialize a secret")
        return {
            "file": {"sha256": config.file_sha256, "path": "config/ai.yaml"},
            "runtime": {
                "active_config_id": runtime.get("active_config_id"),
                "active_file_sha256": active_hash,
                "file_matches_active": active_hash == config.file_sha256,
                "author_tools_enabled": bool(runtime.get("author_tools_enabled")),
                "video_enabled": bool(runtime.get("video_enabled")),
                "chat_enabled": bool(runtime.get("chat_enabled")),
                "gamification_enabled": bool(runtime.get("gamification_enabled")),
            },
            "providers": provider_status(self.settings),
            "connections": connections,
            "profiles": profiles,
            "catalog": catalog,
            "versions": versions,
            "jobs": self.data.list_recent_jobs(),
            "attempts": self.data.list_recent_attempts(),
        }

    def activate_file(self, user: AuthUser) -> dict[str, Any]:
        self.require_admin(user)
        config = self.load_file()
        existing = next((item for item in self.data.list_config_versions() if item.get("file_sha256") == config.file_sha256), None)
        if existing:
            version = existing
        else:
            version = self.data.insert_config_version(
                config=config.raw,
                file_sha256=config.file_sha256,
                description="Activated from config/ai.yaml",
                created_by=user.id,
            )
        self.data.set_active_config(version["id"])
        self._seed_yaml_models(config)
        return {"id": version["id"], "file_sha256": config.file_sha256}

    def refresh_catalog(self, user: AuthUser) -> dict[str, Any]:
        self.require_admin(user)
        config = self.load_file()
        secrets = self.settings.secret_map()
        errors: dict[str, str] = {}
        rows: list[dict[str, Any]] = []
        checked_at = datetime.now(timezone.utc).isoformat()
        for connection in config.connections:
            listed: list[str] = []
            secret = next(((secrets.get(alias) or "").strip() for alias in connection.key_aliases if (secrets.get(alias) or "").strip()), "")
            if secret:
                listed, error = list_remote_models(connection, secret)
                if error:
                    errors[connection.slug] = error
            model_ids = list(dict.fromkeys([*connection.models, *listed]))
            for model_id in model_ids:
                availability = "available" if model_id in listed else "unverified"
                if connection.slug in errors and model_id not in connection.models:
                    continue
                rows.append(
                    {
                        "connection_slug": connection.slug,
                        "provider": connection.provider,
                        "model_id": model_id,
                        "capabilities": _capabilities(connection.slug, model_id, config),
                        "availability": availability,
                        "checked_at": checked_at if listed or connection.slug in errors else None,
                    }
                )
        self.data.upsert_catalog(rows)
        return {"updated": len(rows), "errors": errors, "catalog": self.data.list_catalog()}

    def probe(self, user: AuthUser, profile: str, prompt: str | None) -> dict[str, Any]:
        self.require_admin(user)
        if profile not in PROFILE_CAPABILITY:
            raise ApiError(400, "AI_INVALID_INPUT")
        text = (prompt or DEFAULT_PROBE_PROMPT).strip() or DEFAULT_PROBE_PROMPT
        if len(text) > MAX_PROBE_CHARS:
            raise ApiError(400, "AI_INVALID_INPUT")
        config = self.load_file()
        result = run_text(
            config,
            self.settings.secret_map(),
            profile,
            text,
            self.caller,
            self.data.list_catalog(),
        )
        return {
            "outcome": result.outcome,
            "text": result.text,
            "winner": public_candidate(result.winner) if result.winner else None,
            "attempts": [public_attempt(item) for item in result.attempts],
        }

    def cancel_job(self, user: AuthUser, job_id: str) -> dict[str, Any]:
        self.require_admin(user)
        return self.data.cancel_job(user.token, job_id).__dict__

    def _seed_yaml_models(self, config: AiConfig) -> None:
        rows = []
        for connection in config.connections:
            for model_id in connection.models:
                rows.append(
                    {
                        "connection_slug": connection.slug,
                        "provider": connection.provider,
                        "model_id": model_id,
                        "capabilities": _capabilities(connection.slug, model_id, config),
                        "availability": "unverified",
                    }
                )
        self.data.upsert_catalog(rows)


def _capabilities(slug: str, model_id: str, config: AiConfig) -> list[str]:
    caps: set[str] = set()
    lowered = model_id.lower()
    if "embed" in lowered:
        caps.add("embedding")
    if "transcribe" in lowered:
        caps.add("transcription")
    if config.connection_by_slug(slug) and config.connection_by_slug(slug).provider == "gemini":
        caps.update({"text", "translation", "chat", "structured_output"})
        if "flash" in lowered:
            caps.update({"video", "youtube"})
    elif any(token in lowered for token in ("gpt", "claude", "llama", "mistral", "qwen")):
        caps.update({"text", "translation", "chat", "structured_output"})
    for profile, order in config.profiles.items():
        if slug in order:
            caps.add(PROFILE_CAPABILITY[profile])
    allowed = {
        "text",
        "structured_output",
        "video",
        "youtube",
        "transcription",
        "translation",
        "chat",
        "embedding",
    }
    return sorted(caps & allowed)
