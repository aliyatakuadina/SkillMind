from __future__ import annotations

import base64
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Protocol

import httpx

from dataclasses import dataclass


@dataclass(frozen=True)
class Candidate:
    connection_slug: str
    provider: str
    base_url: str
    key_alias: str
    api_key: str
    quota_group: str | None
    model_id: str


class ProviderError(Exception):
    def __init__(
        self,
        outcome: str,
        *,
        http_status: int | None = None,
        retry_after: datetime | None = None,
        detail: str = "",
        retryable_once: bool = False,
    ) -> None:
        self.outcome = outcome
        self.http_status = http_status
        self.retry_after = retry_after
        self.detail = detail
        self.retryable_once = retryable_once
        super().__init__(detail or outcome)


class ProviderCaller(Protocol):
    def complete(self, candidate: Candidate, prompt: str) -> str: ...


class HttpCaller:
    def complete(self, candidate: Candidate, prompt: str) -> str:
        if candidate.provider == "gemini":
            return complete_gemini(candidate.base_url, candidate.api_key, candidate.model_id, prompt)
        return complete_openai_compatible(candidate.base_url, candidate.api_key, candidate.model_id, prompt)


def gemini_request_body(prompt: str, extra_parts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    parts = [part for part in (extra_parts or []) if isinstance(part, dict)]
    parts.append({"text": prompt})
    body: dict[str, Any] = {"contents": [{"parts": parts}]}
    if extra_parts:
        body["generationConfig"] = {"responseMimeType": "application/json"}
    return body


def complete_gemini(
    base_url: str,
    api_key: str,
    model_id: str,
    prompt: str,
    extra_parts: list[dict[str, Any]] | None = None,
    timeout: float | None = None,
) -> str:
    url = f"{base_url.rstrip('/')}/v1beta/models/{model_id}:generateContent"
    wait = 180.0 if extra_parts and timeout is None else (timeout or 20.0)
    try:
        response = httpx.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=gemini_request_body(prompt, extra_parts),
            timeout=wait,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = _json_body(response)
    if response.status_code >= 400:
        raise classify_provider_error(response.status_code, payload, response.headers, provider="gemini")
    feedback = payload.get("promptFeedback") or {}
    if feedback.get("blockReason"):
        raise ProviderError("refused", http_status=response.status_code, detail=str(feedback.get("blockReason")))
    candidates = payload.get("candidates") or []
    if not candidates:
        raise ProviderError("transient_error", http_status=response.status_code, retryable_once=True, detail="empty_candidates")
    finish = str(candidates[0].get("finishReason") or "")
    if finish in {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT"}:
        raise ProviderError("refused", http_status=response.status_code, detail=finish)
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    text = "".join(str(part.get("text") or "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise ProviderError("transient_error", http_status=response.status_code, retryable_once=True, detail="empty_text")
    return text


def upload_gemini_file(
    base_url: str,
    api_key: str,
    *,
    display_name: str,
    mime_type: str,
    size: int,
    body,
) -> str:
    root = base_url.rstrip("/")
    try:
        started = httpx.post(
            f"{root}/upload/v1beta/files",
            params={"key": api_key},
            headers={
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(size),
                "X-Goog-Upload-Header-Content-Type": mime_type,
                "Content-Type": "application/json",
            },
            json={"file": {"display_name": display_name[:120] or "lecture"}},
            timeout=30.0,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    if started.status_code >= 400:
        raise classify_provider_error(started.status_code, _json_body(started), started.headers, provider="gemini")
    upload_url = started.headers.get("x-goog-upload-url") or started.headers.get("X-Goog-Upload-URL")
    if not upload_url:
        raise ProviderError("transient_error", retryable_once=True, detail="missing_upload_url")
    try:
        finished = httpx.post(
            upload_url,
            headers={
                "X-Goog-Upload-Command": "upload, finalize",
                "X-Goog-Upload-Offset": "0",
                "Content-Length": str(size),
            },
            content=body,
            timeout=600.0,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = _json_body(finished)
    if finished.status_code >= 400:
        raise classify_provider_error(finished.status_code, payload, finished.headers, provider="gemini")
    file_info = payload.get("file") if isinstance(payload.get("file"), dict) else payload
    uri = str((file_info or {}).get("uri") or "")
    name = str((file_info or {}).get("name") or "")
    if not uri and name:
        uri = f"{root}/{name.lstrip('/')}"
    if not uri:
        raise ProviderError("transient_error", retryable_once=True, detail="missing_file_uri")
    return wait_gemini_file(root, api_key, uri)


def wait_gemini_file(base_url: str, api_key: str, file_uri: str, *, attempts: int = 20) -> str:
    name = file_uri.rstrip("/").split("/")[-1]
    url = f"{base_url.rstrip('/')}/v1beta/files/{name}"
    for _ in range(attempts):
        try:
            response = httpx.get(url, headers={"x-goog-api-key": api_key}, timeout=20.0)
        except httpx.HTTPError as error:
            raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
        payload = _json_body(response)
        if response.status_code >= 400:
            raise classify_provider_error(response.status_code, payload, response.headers, provider="gemini")
        info = payload.get("file") if isinstance(payload.get("file"), dict) else payload
        state = str((info or {}).get("state") or "").upper()
        uri = str((info or {}).get("uri") or file_uri)
        if state in {"", "ACTIVE"}:
            return uri
        if state == "FAILED":
            raise ProviderError("invalid_input", detail="file_processing_failed")
        time.sleep(3)
    raise ProviderError("transient_error", retryable_once=True, detail="file_not_ready")


def transcribe_gemini(base_url: str, api_key: str, model_id: str, audio: bytes, mime: str) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/v1beta/models/{model_id}:generateContent"
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": mime,
                            "data": base64.b64encode(audio).decode("ascii"),
                        }
                    }
                ]
            }
        ],
        "generationConfig": {"audioTranscriptionConfig": {"wordTimestamp": True}},
    }
    try:
        response = httpx.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=body,
            timeout=180.0,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = _json_body(response)
    if response.status_code >= 400:
        raise classify_provider_error(response.status_code, payload, response.headers, provider="gemini")
    return payload


def transcribe_openai(base_url: str, api_key: str, model_id: str, audio: bytes, mime: str) -> dict[str, Any]:
    filename = "chunk.mp3" if "mpeg" in mime or mime.endswith("mp3") else "chunk.wav"
    try:
        response = httpx.post(
            f"{openai_root(base_url)}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": model_id, "response_format": "verbose_json", "timestamp_granularities[]": "segment"},
            files={"file": (filename, audio, mime)},
            timeout=300.0,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = _json_body(response)
    if response.status_code >= 400:
        error = classify_provider_error(response.status_code, payload, response.headers, provider="openai")
        detail = (error.detail or "").lower()
        if response.status_code in {404, 405, 415} or (error.outcome == "invalid_input" and "model" in detail):
            raise ProviderError("unavailable_model", http_status=response.status_code, detail=error.detail)
        raise error
    return payload


def openai_root(base_url: str) -> str:
    root = base_url.rstrip("/")
    return root if root.endswith("/v1") else f"{root}/v1"


def complete_openai_compatible(base_url: str, api_key: str, model_id: str, prompt: str) -> str:
    url = f"{openai_root(base_url)}/chat/completions"
    try:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model_id, "messages": [{"role": "user", "content": prompt}], "max_tokens": 1800},
            timeout=180.0,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = _json_body(response)
    if response.status_code >= 400:
        raise classify_provider_error(response.status_code, payload, response.headers, provider="openai")
    choices = payload.get("choices") or []
    if not choices:
        raise ProviderError("transient_error", http_status=response.status_code, retryable_once=True, detail="empty_choices")
    if str(choices[0].get("finish_reason") or "") == "content_filter":
        raise ProviderError("refused", http_status=response.status_code, detail="content_filter")
    message = choices[0].get("message") or {}
    text = str(message.get("content") or "").strip()
    if not text:
        raise ProviderError("transient_error", http_status=response.status_code, retryable_once=True, detail="empty_text")
    return text


def classify_provider_error(
    status: int,
    payload: dict[str, Any],
    headers: Any,
    *,
    provider: str,
) -> ProviderError:
    retry_after = parse_retry_after(headers.get("retry-after") if headers is not None else None)
    message = _error_message(payload)
    lowered = message.lower()
    status_name = str((payload.get("error") or {}).get("status") or payload.get("status") or "")
    if status in (401, 403) or status_name in {"PERMISSION_DENIED", "UNAUTHENTICATED"}:
        return ProviderError("invalid_key", http_status=status, detail=message)
    if status == 429 or status_name == "RESOURCE_EXHAUSTED" or "rate" in lowered and "limit" in lowered:
        return ProviderError("rate_limited", http_status=status or 429, retry_after=retry_after, detail=message)
    if status == 404 or status_name == "NOT_FOUND" or "model" in lowered and "not found" in lowered:
        return ProviderError("unavailable_model", http_status=status, detail=message)
    if any(token in lowered for token in ("safety", "blocked", "content policy", "refused", "prohibited")):
        return ProviderError("refused", http_status=status, detail=message)
    if status == 400 and provider == "gemini" and "model" in lowered:
        return ProviderError("unavailable_model", http_status=status, detail=message)
    if status == 400:
        return ProviderError("invalid_input", http_status=status, detail=message)
    if status >= 500:
        return ProviderError("transient_error", http_status=status, retryable_once=True, detail=message)
    return ProviderError("transient_error", http_status=status, retryable_once=True, detail=message)


def parse_retry_after(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.now(timezone.utc) + timedelta(seconds=int(value))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)


def _json_body(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": {"message": response.text[:300]}}
    return payload if isinstance(payload, dict) else {"error": {"message": str(payload)}}


def _error_message(payload: dict[str, Any]) -> str:
    error = payload.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error.get("status") or "")
    if isinstance(error, str):
        return error
    return str(payload.get("message") or "")
