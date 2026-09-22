from __future__ import annotations

import base64
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

from skillmind_server.adapters import ProviderError, complete_gemini, transcribe_gemini, transcribe_openai
from skillmind_server.authoring import AuthoringError, parse_json_object
from skillmind_server.errors import ApiError
from skillmind_server.router import run_text

CHUNK_SECONDS = 600.0
OVERLAP_SECONDS = 2.0
MAX_DURATION_SECONDS = 7200.0
TRANSCRIBE_PROMPT = (
    "Transcribe this lecture audio. Return JSON only: "
    '{"cues":[{"start":0,"end":1.2,"text":"..."}]}. '
    "Times are seconds from the start of this chunk. Do not translate."
)


class TranscriptDeferred(Exception):
    def __init__(self, code: str = "AI_PROVIDER_UNAVAILABLE") -> None:
        self.code = code
        super().__init__(code)


def plan_chunks(duration: float) -> list[dict[str, Any]]:
    if duration <= 0:
        return []
    chunks: list[dict[str, Any]] = []
    start = 0.0
    index = 0
    while start < duration - 0.001:
        end = min(duration, start + CHUNK_SECONDS)
        chunks.append({"index": index, "start": round(start, 3), "end": round(end, 3)})
        if end >= duration - 0.001:
            break
        nxt = end - OVERLAP_SECONDS
        if nxt <= start:
            break
        start = nxt
        index += 1
    return chunks


def require_audio(info: dict[str, Any]) -> dict[str, Any]:
    try:
        duration = float(info.get("duration_seconds") or 0)
    except (TypeError, ValueError):
        duration = 0
    if duration <= 0:
        raise ApiError(400, "MEDIA_UNREADABLE")
    if duration > MAX_DURATION_SECONDS:
        raise ApiError(400, "MEDIA_DURATION_UNSUPPORTED")
    if not info.get("has_audio"):
        raise ApiError(400, "MEDIA_AUDIO_MISSING")
    return {"duration_seconds": duration, "has_audio": True}


def probe_media(path: str, runner: Callable | None = None) -> dict[str, Any]:
    run = runner or subprocess.run
    try:
        result = run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError as error:
        raise ApiError(503, "MEDIA_FFMPEG_UNAVAILABLE") from error
    except subprocess.TimeoutExpired as error:
        raise ApiError(400, "MEDIA_UNREADABLE") from error
    if getattr(result, "returncode", 1) != 0:
        raise ApiError(400, "MEDIA_UNREADABLE")
    try:
        payload = json.loads(getattr(result, "stdout", "") or "{}")
    except json.JSONDecodeError as error:
        raise ApiError(400, "MEDIA_UNREADABLE") from error
    streams = payload.get("streams") or []
    has_audio = any(isinstance(item, dict) and item.get("codec_type") == "audio" for item in streams)
    try:
        duration = float((payload.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    return require_audio({"duration_seconds": duration, "has_audio": has_audio})


def extract_audio_chunk(source: str, start: float, end: float, runner: Callable | None = None) -> bytes:
    run = runner or subprocess.run
    duration = max(0.1, float(end) - float(start))
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "chunk.mp3"
        try:
            result = run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{float(start):.3f}",
                    "-t",
                    f"{duration:.3f}",
                    "-i",
                    str(source),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-b:a",
                    "64k",
                    str(dest),
                ],
                check=False,
                capture_output=True,
                timeout=180,
            )
        except FileNotFoundError as error:
            raise ApiError(503, "MEDIA_FFMPEG_UNAVAILABLE") from error
        except subprocess.TimeoutExpired as error:
            raise ApiError(400, "MEDIA_UNREADABLE") from error
        if getattr(result, "returncode", 1) != 0 or not dest.is_file():
            raise ApiError(400, "MEDIA_UNREADABLE")
        return dest.read_bytes()


def save_object(storage, object_key: str, dest: Path) -> None:
    body = storage.open_object(object_key)
    try:
        with dest.open("wb") as handle:
            while True:
                chunk = body.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
    finally:
        close = getattr(body, "close", None)
        if close:
            close()


def parse_offset(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().lower()
    if not text:
        return 0.0
    if text.endswith("ms"):
        return float(text[:-2] or 0) / 1000
    if text.endswith("s"):
        return float(text[:-1] or 0)
    return float(text)


def gemini_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for candidate in payload.get("candidates") or []:
        parts = ((candidate.get("content") or {}).get("parts")) or []
        for part in parts:
            if not isinstance(part, dict):
                continue
            transcription = part.get("audioTranscription") or part.get("audio_transcription") or {}
            for item in transcription.get("words") or []:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("word") or item.get("text") or "").strip()
                try:
                    start = parse_offset(item.get("startOffset") if item.get("startOffset") is not None else item.get("start_offset"))
                    end = parse_offset(item.get("endOffset") if item.get("endOffset") is not None else item.get("end_offset"))
                except (TypeError, ValueError):
                    continue
                if text and end > start:
                    words.append({"text": text, "start": start, "end": end})
    return words


def words_to_cues(words: list[dict[str, Any]], *, gap: float = 0.8, max_words: int = 18) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    for word in words:
        if current and (float(word["start"]) - float(current[-1]["end"]) >= gap or len(current) >= max_words):
            packed = _pack(current)
            if packed["text"]:
                cues.append(packed)
            current = []
        current.append(word)
    if current:
        packed = _pack(current)
        if packed["text"]:
            cues.append(packed)
    return cues


def whisper_cues(payload: dict[str, Any]) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    for segment in payload.get("segments") or []:
        if not isinstance(segment, dict):
            continue
        text = str(segment.get("text") or "").strip()[:500]
        try:
            start = float(segment.get("start") or 0)
            end = float(segment.get("end") or 0)
        except (TypeError, ValueError):
            continue
        if text and end > start:
            cue = {"start": round(start, 3), "end": round(end, 3), "text": text}
            if _whisper_uncertain(segment):
                cue["uncertain"] = True
            cues.append(cue)
    return cues


def cues_from_json_text(text: str) -> list[dict[str, Any]]:
    try:
        payload = parse_json_object(text)
    except AuthoringError:
        return []
    raw = payload.get("cues") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return whisper_cues(payload) if isinstance(payload, dict) else []
    cues: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text_value = str(item.get("text") or "").strip()[:500]
        try:
            start = float(item.get("start") if item.get("start") is not None else 0)
            end = float(item.get("end") if item.get("end") is not None else 0)
        except (TypeError, ValueError):
            continue
        if text_value and end > start:
            cue = {"start": round(start, 3), "end": round(end, 3), "text": text_value}
            if item.get("uncertain") is True:
                cue["uncertain"] = True
            cues.append(cue)
    return cues


def absolute_cues(chunk: dict[str, Any], relative: list[dict[str, Any]]) -> list[dict[str, Any]]:
    floor = 0.0 if int(chunk["index"]) == 0 else OVERLAP_SECONDS
    origin = float(chunk["start"])
    limit = float(chunk["end"])
    cues: list[dict[str, Any]] = []
    for item in relative:
        try:
            start_at = float(item["start"])
            end_at = float(item["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if start_at < floor - 0.05:
            continue
        start = round(origin + start_at, 3)
        end = round(min(limit, origin + end_at), 3)
        text = str(item.get("text") or "").strip()[:500]
        if text and end > start:
            cue = {"start": start, "end": end, "text": text}
            if item.get("uncertain") is True:
                cue["uncertain"] = True
            cues.append(cue)
    return cues


def assemble_cues(chunks: list[dict[str, Any]], stored: dict[str, list]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for chunk in chunks:
        merged.extend(stored.get(f"asr:{int(chunk['index'])}") or [])
    return merged


MAX_CUE_CHARS = 120


def split_long_cues(cues: list[dict[str, Any]], *, max_chars: int = MAX_CUE_CHARS) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for cue in cues:
        text = str(cue.get("text") or "").strip()
        try:
            start = float(cue["start"])
            end = float(cue["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if not text or end <= start:
            continue
        uncertain = cue.get("uncertain") is True
        if len(text) <= max_chars:
            item = {"start": round(start, 3), "end": round(end, 3), "text": text}
            if uncertain:
                item["uncertain"] = True
            result.append(item)
            continue
        parts = _split_text(text, max_chars)
        weights = [max(len(part), 1) for part in parts]
        total = float(sum(weights))
        cursor = start
        span = end - start
        for index, part in enumerate(parts):
            if index == len(parts) - 1:
                piece_end = end
            else:
                piece_end = round(cursor + span * (weights[index] / total), 3)
                if piece_end <= cursor:
                    piece_end = round(min(end, cursor + 0.05), 3)
            item = {"start": round(cursor, 3), "end": piece_end, "text": part}
            if uncertain:
                item["uncertain"] = True
            result.append(item)
            cursor = piece_end
    return result


def _split_text(text: str, max_chars: int) -> list[str]:
    words = text.split()
    if not words:
        return [text[:max_chars]] if text else []
    parts: list[str] = []
    current: list[str] = []
    length = 0
    for word in words:
        addition = len(word) if not current else len(word) + 1
        if current and length + addition > max_chars:
            parts.append(" ".join(current))
            current = [word]
            length = len(word)
            continue
        current.append(word)
        length += addition
    if current:
        parts.append(" ".join(current))
    return parts or [text[:max_chars]]


def completed_checkpoint(claim: dict, key: str) -> dict | None:
    for step in claim.get("steps") or []:
        if step.get("step_key") == key and step.get("status") == "completed":
            checkpoint = step.get("checkpoint")
            return checkpoint if isinstance(checkpoint, dict) else {}
    return None


def public_chunk(item: dict[str, Any]) -> dict[str, Any]:
    return {"index": int(item["index"]), "start": round(float(item["start"]), 3), "end": round(float(item["end"]), 3)}


def transcribe_chunk_audio(config, secrets: dict[str, str], audio: bytes, mime: str, duration: float, caller=None) -> list[dict[str, Any]]:
    def complete(candidate, _prompt: str) -> str:
        if caller:
            return caller(candidate, TRANSCRIBE_PROMPT)
        try:
            cues = _provider_cues(candidate, audio, mime, duration)
        except ProviderError as error:
            specialized = "transcribe" in candidate.model_id or "whisper" in candidate.model_id
            if error.outcome == "invalid_input" and not specialized:
                raise ProviderError("unavailable_model", http_status=error.http_status, detail=error.detail) from error
            raise
        if not cues:
            specialized = "transcribe" in candidate.model_id or "whisper" in candidate.model_id
            raise ProviderError("invalid_input" if specialized else "unavailable_model", detail="empty_transcript")
        return json.dumps({"cues": cues})

    result = run_text(config, secrets, "transcription", TRANSCRIBE_PROMPT, complete)
    if result.outcome == "waiting_provider":
        raise TranscriptDeferred()
    if result.outcome == "refused":
        raise ApiError(400, "AI_PROVIDER_REFUSED")
    if result.outcome == "invalid_input":
        raise ApiError(400, "MEDIA_AUDIO_MISSING")
    if not result.text:
        raise ApiError(503, "AI_PROVIDER_UNAVAILABLE")
    return cues_from_json_text(result.text)


def _provider_cues(candidate, audio: bytes, mime: str, duration: float) -> list[dict[str, Any]]:
    if candidate.provider == "gemini" and "transcribe" in candidate.model_id:
        payload = transcribe_gemini(candidate.base_url, candidate.api_key, candidate.model_id, audio, mime)
        cues = words_to_cues(gemini_words(payload))
        if cues:
            return cues
        text = _gemini_text(payload)
        parsed = cues_from_json_text(text) if text else []
        if parsed:
            return parsed
        if text:
            return [{"start": 0.0, "end": round(max(duration, 0.1), 3), "text": text[:500]}]
        return []
    if candidate.provider == "gemini":
        text = complete_gemini(
            candidate.base_url,
            candidate.api_key,
            candidate.model_id,
            TRANSCRIBE_PROMPT,
            extra_parts=[{"inline_data": {"mime_type": mime, "data": base64.b64encode(audio).decode("ascii")}}],
            timeout=180.0,
        )
        return cues_from_json_text(text)
    return whisper_cues(transcribe_openai(candidate.base_url, candidate.api_key, candidate.model_id, audio, mime))


def _gemini_text(payload: dict[str, Any]) -> str:
    texts: list[str] = []
    for candidate in payload.get("candidates") or []:
        parts = ((candidate.get("content") or {}).get("parts")) or []
        for part in parts:
            if isinstance(part, dict) and part.get("text"):
                texts.append(str(part["text"]))
    return "".join(texts).strip()


def _whisper_uncertain(segment: dict[str, Any]) -> bool:
    try:
        if segment.get("no_speech_prob") is not None and float(segment["no_speech_prob"]) >= 0.6:
            return True
    except (TypeError, ValueError):
        pass
    try:
        if segment.get("avg_logprob") is not None and float(segment["avg_logprob"]) <= -1.0:
            return True
    except (TypeError, ValueError):
        pass
    try:
        if segment.get("compression_ratio") is not None and float(segment["compression_ratio"]) >= 2.4:
            return True
    except (TypeError, ValueError):
        pass
    return False


def _pack(words: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "start": round(float(words[0]["start"]), 3),
        "end": round(float(words[-1]["end"]), 3),
        "text": " ".join(str(word["text"]).strip() for word in words).strip()[:500],
    }
