from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from skillmind_server.errors import ApiError

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_LENGTH = re.compile(r'"lengthSeconds"\s*:\s*"?(\d+)"?')
_APPROX_MS = re.compile(r'"approxDurationMs"\s*:\s*"?(\d+)"?')
MAX_DURATION_SECONDS = 7200
WATCH_TEMPLATE = "https://www.youtube.com/watch?v={video_id}"


def parse_youtube_id(value: str) -> str:
    raw = (value or "").strip()
    if YOUTUBE_ID.fullmatch(raw):
        return raw
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = parsed.path or ""
    segments = [part for part in path.split("/") if part]
    video_id = ""
    if host in {"youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"}:
        query = parse_qs(parsed.query)
        if query.get("v"):
            video_id = query["v"][0]
        elif segments and segments[0] in {"embed", "shorts", "live", "v"} and len(segments) > 1:
            video_id = segments[1]
    elif host == "youtu.be" and segments:
        video_id = segments[0]
    video_id = video_id.split("?")[0].split("&")[0]
    if not YOUTUBE_ID.fullmatch(video_id):
        raise ApiError(400, "YOUTUBE_ID_INVALID")
    return video_id


def watch_url(video_id: str) -> str:
    return WATCH_TEMPLATE.format(video_id=video_id)


def probe_youtube_public(video_id: str) -> dict[str, Any]:
    url = watch_url(video_id)
    try:
        oembed = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            headers={"User-Agent": "SkillMind/1.0"},
            timeout=8.0,
            follow_redirects=True,
        )
    except httpx.HTTPError as error:
        raise ApiError(502, "YOUTUBE_UNAVAILABLE") from error
    if oembed.status_code >= 400:
        raise ApiError(400, "YOUTUBE_UNAVAILABLE")
    title = ""
    try:
        payload = oembed.json()
        if isinstance(payload, dict):
            title = str(payload.get("title") or "")[:255]
    except ValueError:
        title = ""
    duration = _watch_duration(video_id)
    if duration is None or duration <= 0:
        raise ApiError(400, "YOUTUBE_DURATION_UNKNOWN")
    if duration > MAX_DURATION_SECONDS:
        raise ApiError(400, "MEDIA_DURATION_UNSUPPORTED")
    return {"duration_seconds": duration, "title": title}


def _watch_duration(video_id: str) -> float | None:
    try:
        response = httpx.get(
            watch_url(video_id),
            headers={"User-Agent": "Mozilla/5.0 SkillMind/1.0"},
            timeout=8.0,
            follow_redirects=True,
        )
    except httpx.HTTPError:
        return None
    if response.status_code >= 400:
        return None
    body = response.text or ""
    length = _LENGTH.search(body)
    if length:
        return float(length.group(1))
    approx = _APPROX_MS.search(body)
    if approx:
        return float(approx.group(1)) / 1000.0
    return None
