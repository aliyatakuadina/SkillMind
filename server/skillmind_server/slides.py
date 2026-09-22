from __future__ import annotations

import base64
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

from skillmind_server.adapters import ProviderError, complete_gemini
from skillmind_server.asr import TranscriptDeferred
from skillmind_server.authoring import AuthoringError, parse_json_object
from skillmind_server.errors import ApiError
from skillmind_server.router import run_text

MAX_FRAMES = 12
SLIDE_PROMPT = (
    "These are frames from a lecture. Return JSON only: "
    '{"observations":[{"time":12.5,"text":"visible slide or screen text"}]}. '
    "Use only text that is actually visible. Keep the given timestamps. Do not translate."
)


def frame_times(duration: float, limit: int = MAX_FRAMES) -> list[float]:
    if duration <= 0:
        return []
    if duration <= 30:
        return [round(min(1.0, duration / 2), 3)]
    count = min(limit, max(1, int(duration // 60) or 1))
    step = duration / count
    return [round(min(duration - 0.05, (index + 0.5) * step), 3) for index in range(count)]


def sanitize_slide_notes(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    notes: list[dict[str, Any]] = []
    for item in raw[:MAX_FRAMES]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:500]
        try:
            moment = float(item.get("time") if item.get("time") is not None else item.get("start") or 0)
        except (TypeError, ValueError):
            continue
        if text and moment >= 0:
            notes.append({"time": round(moment, 3), "text": text})
    return notes


def notes_from_model(text: str) -> list[dict[str, Any]]:
    try:
        payload = parse_json_object(text)
    except AuthoringError:
        return []
    if not isinstance(payload, dict):
        return []
    return sanitize_slide_notes(payload.get("observations") or payload.get("slides") or [])


def extract_jpeg(source: str, at: float, runner: Callable | None = None) -> bytes:
    run = runner or subprocess.run
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "frame.jpg"
        try:
            result = run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{float(at):.3f}",
                    "-i",
                    str(source),
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=640:-2",
                    "-q:v",
                    "8",
                    str(dest),
                ],
                check=False,
                capture_output=True,
                timeout=60,
            )
        except FileNotFoundError as error:
            raise ApiError(503, "MEDIA_FFMPEG_UNAVAILABLE") from error
        except subprocess.TimeoutExpired as error:
            raise ApiError(400, "MEDIA_UNREADABLE") from error
        if getattr(result, "returncode", 1) != 0 or not dest.is_file():
            return b""
        return dest.read_bytes()


def extract_frames(source: str, duration: float, runner: Callable | None = None) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for moment in frame_times(duration):
        image = extract_jpeg(source, moment, runner)
        if image:
            frames.append({"time": moment, "image": image})
    return frames


def analyze_slides(config, secrets: dict[str, str], frames: list[dict[str, Any]], caller=None) -> list[dict[str, Any]]:
    if not frames:
        return []
    listed = ", ".join(f"{float(frame['time']):.3f}" for frame in frames)
    prompt = SLIDE_PROMPT + f" Timestamps: {listed}."

    def complete(candidate, text: str) -> str:
        if caller:
            return caller(candidate, text)
        if candidate.provider != "gemini":
            raise ProviderError("unavailable_model", detail="slides_require_gemini")
        parts: list[dict[str, Any]] = []
        for frame in frames:
            parts.append({"text": f"time={float(frame['time']):.3f}"})
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(frame["image"]).decode("ascii"),
                    }
                }
            )
        return complete_gemini(
            candidate.base_url,
            candidate.api_key,
            candidate.model_id,
            text,
            extra_parts=parts,
            timeout=180.0,
        )

    result = run_text(config, secrets, "video", prompt, complete)
    if result.outcome == "waiting_provider":
        raise TranscriptDeferred()
    if result.outcome == "refused":
        raise ApiError(400, "AI_PROVIDER_REFUSED")
    if not result.text:
        return []
    return notes_from_model(result.text)
