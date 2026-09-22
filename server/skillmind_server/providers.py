from __future__ import annotations

from typing import Any

import httpx

from skillmind_server.config_file import Connection
from skillmind_server.settings import Settings


def provider_status(settings: Settings) -> dict:
    litellm_ok = False
    litellm_error = None
    try:
        headers = {}
        if settings.litellm_api_key_1:
            headers["Authorization"] = f"Bearer {settings.litellm_api_key_1}"
        response = httpx.get(f"{settings.litellm_base_url.rstrip('/')}/health", headers=headers, timeout=2.0)
        litellm_ok = response.status_code < 500
        if not litellm_ok:
            litellm_error = f"HTTP_{response.status_code}"
    except httpx.HTTPError as error:
        litellm_error = error.__class__.__name__
    return {
        "gemini": {"configured": bool(settings.gemini_api_key_1)},
        "openai": {"configured": bool(settings.openai_api_key_1)},
        "litellm": {
            "configured": bool(settings.litellm_api_key_1 or settings.litellm_base_url),
            "base_url": settings.litellm_base_url,
            "reachable": litellm_ok,
            "error": litellm_error,
        },
    }


def list_remote_models(connection: Connection, api_key: str) -> tuple[list[str], str | None]:
    try:
        if connection.provider == "gemini":
            return _list_gemini(connection.base_url, api_key), None
        return _list_openai_compatible(connection.base_url, api_key), None
    except httpx.HTTPError as error:
        return [], error.__class__.__name__
    except Exception as error:  # noqa: BLE001 - catalog refresh must not fail the panel
        return [], error.__class__.__name__


def _list_gemini(base_url: str, api_key: str) -> list[str]:
    models: list[str] = []
    page_token = ""
    for _ in range(20):
        params: dict[str, Any] = {"pageSize": 100}
        if page_token:
            params["pageToken"] = page_token
        response = httpx.get(
            f"{base_url.rstrip('/')}/v1beta/models",
            headers={"x-goog-api-key": api_key},
            params=params,
            timeout=8.0,
        )
        if response.status_code >= 400:
            raise httpx.HTTPStatusError("gemini list failed", request=response.request, response=response)
        payload = response.json() if response.content else {}
        for item in payload.get("models") or []:
            name = str(item.get("name") or "")
            model_id = name.split("/", 1)[1] if name.startswith("models/") else name
            methods = item.get("supportedGenerationMethods") or []
            if model_id and (not methods or "generateContent" in methods or "embedContent" in methods):
                models.append(model_id)
        page_token = str(payload.get("nextPageToken") or "")
        if not page_token:
            break
    return _unique(models)


def _list_openai_compatible(base_url: str, api_key: str) -> list[str]:
    from skillmind_server.adapters import openai_root

    response = httpx.get(
        f"{openai_root(base_url)}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=8.0,
    )
    if response.status_code >= 400:
        raise httpx.HTTPStatusError("openai list failed", request=response.request, response=response)
    payload = response.json() if response.content else {}
    items = payload.get("data") or payload.get("models") or []
    models = []
    for item in items:
        if isinstance(item, dict):
            model_id = str(item.get("id") or item.get("name") or "").strip()
        else:
            model_id = str(item).strip()
        if model_id:
            models.append(model_id)
        if len(models) >= 200:
            break
    return _unique(models)


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result
