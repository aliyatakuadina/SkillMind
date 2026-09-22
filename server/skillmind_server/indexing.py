from __future__ import annotations

import math
import re
from typing import Any
from uuid import uuid4

from skillmind_server.adapters import Candidate, ProviderError
from skillmind_server.errors import ApiError
from skillmind_server.router import run_text

EMBED_MODEL = "qwen-embed"
EMBED_DIM = 1024
CHUNK_CHARS = 900


def chunk_text(text: str, *, size: int = CHUNK_CHARS) -> list[str]:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    parts: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + size)
        if end < len(cleaned):
            cut = cleaned.rfind(" ", start, end)
            if cut > start + size // 2:
                end = cut
        piece = cleaned[start:end].strip()
        if piece:
            parts.append(piece)
        start = end if end > start else end + 1
    return parts


def bundle_chunks(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    languages = bundle.get("languages") or {}
    rows: list[dict[str, Any]] = []
    for lang, item in languages.items():
        if not isinstance(item, dict):
            continue
        lecture = item.get("lecture") if isinstance(item.get("lecture"), dict) else {}
        bodies: list[str] = [str(item.get("title") or ""), str(item.get("summary") or "")]
        for section in lecture.get("sections") or []:
            if isinstance(section, dict):
                bodies.append(" ".join(str(section.get(key) or "") for key in ("heading", "body")).strip())
        text = "\n".join(part for part in bodies if part.strip())
        for index, piece in enumerate(chunk_text(text)):
            rows.append(
                {
                    "language": lang,
                    "source_kind": "lecture",
                    "chunk_key": f"lecture:{lang}:{index}",
                    "content": piece,
                    "start_seconds": None,
                    "end_seconds": None,
                }
            )
        for index, cue in enumerate(item.get("cues") or []):
            if not isinstance(cue, dict):
                continue
            cue_text = str(cue.get("text") or "").strip()
            if not cue_text:
                continue
            rows.append(
                {
                    "language": lang,
                    "source_kind": "subtitle",
                    "chunk_key": f"subtitle:{lang}:{index}",
                    "content": cue_text,
                    "start_seconds": cue.get("start"),
                    "end_seconds": cue.get("end"),
                }
            )
    return rows


def cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return -1.0
    dot = sum(a * b for a, b in zip(left, right))
    na = math.sqrt(sum(a * a for a in left))
    nb = math.sqrt(sum(b * b for b in right))
    if na == 0 or nb == 0:
        return -1.0
    return dot / (na * nb)


def embed_texts(config, secrets: dict[str, str], texts: list[str], caller=None) -> list[list[float]]:
    if not texts:
        return []
    import json

    def complete(candidate: Candidate, prompt: str) -> str:
        if caller:
            return caller(candidate, json.dumps({"embed": texts}))
        if candidate.provider == "gemini":
            return _gemini_embed(candidate.base_url, candidate.api_key, candidate.model_id, texts)
        return _openai_embed(candidate.base_url, candidate.api_key, candidate.model_id, texts)

    result = run_text(config, secrets, "embedding", "embed", complete)
    if result.outcome != "succeeded" or not result.text:
        raise ApiError(503, "AI_PROVIDER_UNAVAILABLE")
    payload = json.loads(result.text)
    if not isinstance(payload, list):
        raise ApiError(502, "AI_INVALID_OUTPUT")
    vectors: list[list[float]] = []
    for item in payload:
        if not isinstance(item, list) or len(item) != EMBED_DIM:
            raise ApiError(502, "AI_INVALID_OUTPUT")
        vectors.append([float(value) for value in item])
    return vectors


def _gemini_embed(base_url: str, api_key: str, model_id: str, texts: list[str]) -> str:
    import json

    import httpx

    url = f"{base_url.rstrip('/')}/v1beta/models/{model_id}:batchEmbedContents"
    body = {
        "requests": [
            {"model": f"models/{model_id}", "content": {"parts": [{"text": text}]}, "outputDimensionality": EMBED_DIM}
            for text in texts
        ]
    }
    try:
        response = httpx.post(url, headers={"x-goog-api-key": api_key, "Content-Type": "application/json"}, json=body, timeout=60.0)
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    if response.status_code >= 400:
        from skillmind_server.adapters import classify_provider_error

        raise classify_provider_error(response.status_code, payload if isinstance(payload, dict) else {}, response.headers, provider="gemini")
    embeddings = []
    for item in payload.get("embeddings") or []:
        values = item.get("values") if isinstance(item, dict) else None
        if isinstance(values, list):
            embeddings.append(values)
    if len(embeddings) != len(texts):
        raise ProviderError("transient_error", retryable_once=True, detail="embed_count_mismatch")
    return json.dumps(embeddings)


def _openai_embed(base_url: str, api_key: str, model_id: str, texts: list[str]) -> str:
    import json

    import httpx

    from skillmind_server.adapters import classify_provider_error, openai_root

    url = f"{openai_root(base_url)}/embeddings"
    try:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model_id, "input": texts},
            timeout=60.0,
        )
    except httpx.HTTPError as error:
        raise ProviderError("transient_error", detail=error.__class__.__name__, retryable_once=True) from error
    payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    if response.status_code >= 400:
        raise classify_provider_error(response.status_code, payload if isinstance(payload, dict) else {}, response.headers, provider="openai")
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ProviderError("transient_error", retryable_once=True, detail="embed_payload")
    ordered = sorted(rows, key=lambda item: int(item.get("index") or 0) if isinstance(item, dict) else 0)
    embeddings = []
    for item in ordered:
        values = item.get("embedding") if isinstance(item, dict) else None
        if isinstance(values, list):
            embeddings.append(values)
    if len(embeddings) != len(texts):
        raise ProviderError("transient_error", retryable_once=True, detail="embed_count_mismatch")
    return json.dumps(embeddings)


def new_index_id() -> str:
    return str(uuid4())
