from __future__ import annotations

from functools import cached_property
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO / ".env", ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = Field(default="", validation_alias=AliasChoices("SUPABASE_URL", "VITE_SUPABASE_URL"))
    supabase_service_role_key: str = ""
    supabase_anon_key: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
    )
    supabase_jwt_secret: str = ""
    cors_origins: str = (
        "https://skill-mind-sigma.vercel.app,https://itwin.kz,http://localhost:5173,http://127.0.0.1:5173"
    )

    minio_endpoint: str = "127.0.0.1:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "skillmind-media"
    minio_public_endpoint: str = "itwin.kz"
    minio_public_use_ssl: bool = True
    minio_region: str = "us-east-1"

    gemini_api_key_1: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY_1", "GEMINI_API_KEY"))
    openai_api_key_1: str = Field(default="", validation_alias=AliasChoices("OPENAI_API_KEY_1", "OPENAI_API_KEY"))
    litellm_api_key_1: str = Field(default="", validation_alias=AliasChoices("LITELLM_API_KEY_1", "LITELLM_API_KEY"))
    litellm_base_url: str = "http://127.0.0.1:4000"

    skillmind_mode: str = "cloud"
    database_url: str = ""
    db_host: str = "127.0.0.1"
    db_port: int = 5440
    db_user: str = "postgres"
    db_password: str = ""
    db_name: str = "skillmind"
    local_jwt_secret: str = ""

    worker_id: str = "skillmind-worker-1"
    worker_poll_seconds: float = 2.0
    worker_lease_seconds: int = 90
    config_path: str = str(REPO / "config" / "ai.yaml")

    @cached_property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def media_configured(self) -> bool:
        return bool(self.minio_access_key and self.minio_secret_key)

    @property
    def local_mode(self) -> bool:
        return self.skillmind_mode.strip().lower() == "local"

    @property
    def postgres_dsn(self) -> str:
        if self.database_url.strip():
            return self.database_url.strip()
        from urllib.parse import quote_plus

        return (
            f"postgresql://{quote_plus(self.db_user)}:{quote_plus(self.db_password)}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    def secret_map(self) -> dict[str, str]:
        return {
            "GEMINI_API_KEY_1": self.gemini_api_key_1,
            "OPENAI_API_KEY_1": self.openai_api_key_1,
            "LITELLM_API_KEY_1": self.litellm_api_key_1,
        }
