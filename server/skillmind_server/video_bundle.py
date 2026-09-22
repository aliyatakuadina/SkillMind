from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from skillmind_server.authoring import AuthoringError
from skillmind_server.youtube import YOUTUBE_ID, MAX_DURATION_SECONDS

LANGUAGES = ("ru", "kk", "en")


def prompt_for_video(*, youtube_id: str | None = None, duration_seconds: float | None, source: str = "youtube") -> str:
    duration = f"{duration_seconds:.0f}s" if duration_seconds else "unknown"
    attached = (
        "Watch the attached lecture video and return JSON only. "
        if source == "file"
        else "Watch the attached public YouTube video and return JSON only. "
    )
    identity = f"youtube_id={youtube_id}. " if youtube_id else "source=uploaded_file. "
    return (
        attached
        + "Shape: {kind:video_bundle, languages:{ru,kk,en}}. "
        "Each language has title (1-300 chars), summary, lecture "
        "{goals[], sections[{heading,body,start_seconds}], definitions[{term,meaning}], "
        "examples[{text,from_source}], self_check[{prompt}]}, glossary[{term,meaning}], "
        "and cues[{start,end,text}] in seconds. "
        "Kazakh must use Cyrillic. Keep names, numbers and glossary terms aligned. "
        "Mark model-invented examples with from_source=false. "
        "Set cue.uncertain to true when the timestamp is doubtful. Do not publish. "
        + identity
        + f"duration={duration}."
    )


PROMPT_CHAR_BUDGET = 12000


def approx_tokens(text: str) -> int:
    return max(1, len(text) // 3)


def cue_windows(cues: list[dict[str, Any]], *, budget: int = PROMPT_CHAR_BUDGET) -> list[list[dict[str, Any]]]:
    windows: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    size = 0
    for cue in cues:
        line = f"{float(cue.get('start') or 0):.0f}-{float(cue.get('end') or 0):.0f} {cue.get('text') or ''}\n"
        if current and size + len(line) > budget:
            windows.append(current)
            current = []
            size = 0
        current.append(cue)
        size += len(line)
    if current:
        windows.append(current)
    return windows or [[]]


def prompt_for_transcript_window(
    cues: list[dict[str, Any]],
    *,
    part: int,
    total: int,
    duration_seconds: float | None,
) -> str:
    lines = [
        f"{float(cue['start']):.0f}-{float(cue['end']):.0f} {cue.get('text') or ''}"
        for cue in cues
    ]
    duration = f"{duration_seconds:.0f}s" if duration_seconds else "unknown"
    return (
        "Summarize this part of a Russian lesson transcript. Return JSON only. "
        "Shape: {sections:[{heading,body,start_seconds}]}. "
        "Write 1-4 short sections. Do not copy every cue and do not return cues. "
        f"Part {part} of {total}. duration={duration}.\n" + "\n".join(lines)
    )


def prompt_for_lecture_overview(sections: list[dict[str, Any]], duration_seconds: float | None) -> str:
    compact = [
        {
            "heading": str(section.get("heading") or "")[:160],
            "start_seconds": section.get("start_seconds"),
            "body": str(section.get("body") or "")[:500],
        }
        for section in sections[:30]
    ]
    duration = f"{duration_seconds:.0f}s" if duration_seconds else "unknown"
    return (
        "Write the Russian lecture frame from these sections. Return JSON only. "
        "Shape: {title, summary, goals:[], definitions:[{term,meaning}], "
        "examples:[{text,from_source}], self_check:[], glossary:[{term,meaning}]}. "
        "Title is 1-300 characters. Summary is at least 20 characters. "
        f"duration={duration}.\n{json.dumps(compact, ensure_ascii=False)}"
    )


def prompt_for_text_batch(lines: list[str], *, target_name: str) -> str:
    return (
        f"Translate each line to {target_name}. Return JSON only: "
        "{\"lines\":[...]} with the same count and order. Do not merge or skip lines.\n"
        + json.dumps(lines, ensure_ascii=False)
    )


def prompt_for_transcript(
    cues: list[dict[str, Any]],
    duration_seconds: float | None,
    slides: list[dict[str, Any]] | None = None,
) -> str:
    lines = [
        f"{index}. {float(cue['start']):.3f}-{float(cue['end']):.3f} {cue['text']}"
        for index, cue in enumerate(cues, start=1)
    ]
    duration = f"{duration_seconds:.0f}s" if duration_seconds else "unknown"
    visible = [
        f"{float(item['time']):.3f} {item['text']}"
        for item in (slides or [])
        if item.get("text")
    ]
    screen = (
        "Visible slides and screen text, with times in seconds:\n" + "\n".join(visible) + "\n"
        "Use that text in lecture sections. Mark examples taken from the screen with from_source=true.\n"
        if visible
        else ""
    )
    return (
        "Build a Russian lecture from this transcript. Return JSON only. "
        "Shape: {kind:video_bundle, source:file, languages:{ru:{title,summary,lecture,glossary,cues}}}. "
        "Russian language has title (1-300 chars), summary, lecture "
        "{goals[], sections[{heading,body,start_seconds}], definitions[{term,meaning}], "
        "examples[{text,from_source}], self_check[{prompt}]}, glossary[{term,meaning}], "
        f"and exactly {len(cues)} cues in this order. "
        "Keep each cue start and end; write Russian cue text from the transcript. "
        "Do not invent new cue boundaries. Mark invented examples with from_source=false. Do not publish. "
        f"duration={duration}.\n" + screen + "\n".join(lines)
    )


def prompt_for_translation(
    source_language: dict[str, Any],
    target: str,
    cues: list[dict[str, Any]],
) -> str:
    if target not in {"kk", "en"}:
        raise AuthoringError("AI_INVALID_INPUT")
    target_name = "Kazakh (Cyrillic)" if target == "kk" else "English"
    cue_times = [
        f"{index}. {float(cue['start']):.3f}-{float(cue['end']):.3f}"
        for index, cue in enumerate(cues, start=1)
    ]
    compact = {
        "title": source_language.get("title"),
        "summary": source_language.get("summary"),
        "lecture": source_language.get("lecture"),
        "glossary": source_language.get("glossary"),
        "cues": [{"text": cue.get("text")} for cue in (source_language.get("cues") or [])],
    }
    return (
        f"Translate this Russian lecture package to {target_name}. Return JSON only. "
        "Shape: {title, summary, lecture "
        "{goals[], sections[{heading,body,start_seconds}], definitions[{term,meaning}], "
        "examples[{text,from_source}], self_check[{prompt}]}, glossary[{term,meaning}], "
        f"cues[{len(cues)}" + "]}. "
        "Keep the same cue count and order. Copy each listed cue start and end exactly; translate only text. "
        "Do not invent new cue boundaries or times. "
        "Kazakh must use Cyrillic. Mark invented examples with from_source=false. Do not publish.\n"
        f"SOURCE_RU:\n{json.dumps(compact, ensure_ascii=False)}\n"
        "CUE_TIMES:\n" + "\n".join(cue_times)
    )


def extract_language_payload(payload: dict[str, Any], lang: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise AuthoringError("AI_INVALID_OUTPUT")
    languages = payload.get("languages")
    if isinstance(languages, dict) and isinstance(languages.get(lang), dict):
        return languages[lang]
    nested = payload.get(lang)
    if isinstance(nested, dict) and ("title" in nested or "cues" in nested or "lecture" in nested):
        return nested
    if "title" in payload or "cues" in payload or "lecture" in payload:
        return payload
    raise AuthoringError("AI_INVALID_OUTPUT")


def sanitize_language(item: dict[str, Any], *, duration_seconds: float | None = None) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise AuthoringError("AI_INVALID_OUTPUT")
    title = str(item.get("title") or "").strip()[:300]
    summary = str(item.get("summary") or "").strip()[:8000]
    if len(title) < 1 or len(summary) < 3:
        raise AuthoringError("AI_INVALID_OUTPUT")
    lecture = _lecture(item.get("lecture") if isinstance(item.get("lecture"), dict) else {})
    cues = _cues(item.get("cues") or [], _duration(duration_seconds))
    if not cues:
        raise AuthoringError("AI_INVALID_OUTPUT")
    return {
        "title": title,
        "summary": summary,
        "lecture": lecture,
        "glossary": _glossary(item.get("glossary") or []),
        "cues": cues,
        "vtt_text": to_vtt(cues),
        "srt_text": to_srt(cues),
    }


def lock_language_cues(item: dict[str, Any], cues: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise AuthoringError("AI_INVALID_OUTPUT")
    current = item.get("cues")
    if not isinstance(current, list) or len(current) != len(cues):
        raise AuthoringError("AI_INVALID_OUTPUT")
    locked = []
    for cue, source in zip(current, cues):
        text = str((cue or {}).get("text") or "").strip()
        if not text:
            raise AuthoringError("AI_INVALID_OUTPUT")
        locked_cue = {"start": source["start"], "end": source["end"], "text": text}
        if source.get("uncertain") is True:
            locked_cue["uncertain"] = True
        locked.append(locked_cue)
    item["cues"] = locked
    item["vtt_text"] = to_vtt(locked)
    item["srt_text"] = to_srt(locked)
    return item


def lock_cue_timeline(bundle: dict[str, Any], cues: list[dict[str, Any]]) -> dict[str, Any]:
    languages = bundle.get("languages")
    if not isinstance(languages, dict):
        raise AuthoringError("AI_INVALID_OUTPUT")
    for lang in LANGUAGES:
        item = languages.get(lang)
        if not isinstance(item, dict):
            raise AuthoringError("AI_INVALID_OUTPUT")
        languages[lang] = lock_language_cues(item, cues)
    return bundle


def sanitize_video_bundle(
    payload: dict[str, Any],
    *,
    youtube_id: str | None = None,
    duration_seconds: float | None,
    source: str | None = None,
) -> dict[str, Any]:
    source = str(source or payload.get("source") or ("youtube" if youtube_id else "file")).strip() or "file"
    video_id = str(youtube_id or payload.get("youtube_id") or "").strip()
    if source == "youtube" and not YOUTUBE_ID.fullmatch(video_id):
        raise AuthoringError("AI_INVALID_INPUT")
    duration = _duration(duration_seconds)
    languages_in = payload.get("languages") if isinstance(payload.get("languages"), dict) else payload
    languages: dict[str, Any] = {}
    for lang in LANGUAGES:
        item = languages_in.get(lang) if isinstance(languages_in, dict) else None
        if not isinstance(item, dict):
            raise AuthoringError("AI_INVALID_OUTPUT")
        languages[lang] = sanitize_language(item, duration_seconds=duration)
    return {
        "kind": "video_bundle",
        "source": source,
        "youtube_id": video_id or None,
        "duration_seconds": duration,
        "published": False,
        "languages": languages,
    }


def to_vtt(cues: list[dict[str, Any]]) -> str:
    lines = ["WEBVTT", ""]
    for cue in cues:
        lines.append(f"{_timestamp(cue['start'])} --> {_timestamp(cue['end'])}")
        lines.append(str(cue["text"]))
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def to_srt(cues: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for index, cue in enumerate(cues, start=1):
        lines.append(str(index))
        lines.append(f"{_timestamp(cue['start'], srt=True)} --> {_timestamp(cue['end'], srt=True)}")
        lines.append(str(cue["text"]))
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def persist_video_draft(client, job: dict[str, Any], output: dict[str, Any]) -> str | None:
    if not hasattr(client, "table"):
        return None
    course_id = job.get("course_id")
    lesson_id = job.get("lesson_id")
    source_id = job.get("source_id")
    lesson_revision = job.get("lesson_revision")
    source_revision = job.get("source_revision")
    if not course_id or not lesson_id or not source_id or not lesson_revision or not source_revision:
        return None
    languages = output.get("languages") or {}
    if any(lang not in languages for lang in LANGUAGES):
        return None
    bundle_id = str(uuid4())
    try:
        existing = (
            client.table("lesson_ai_bundles")
            .select("version_number")
            .eq("lesson_id", lesson_id)
            .order("version_number", desc=True)
            .limit(1)
            .execute()
        )
        rows = existing.data or []
        version = int(rows[0]["version_number"]) + 1 if rows else 1
        client.table("lesson_ai_bundles").insert(
            {
                "id": bundle_id,
                "course_id": course_id,
                "lesson_id": lesson_id,
                "source_id": source_id,
                "job_id": job.get("id"),
                "version_number": version,
                "lesson_revision": lesson_revision,
                "source_revision": source_revision,
                "status": "draft",
            }
        ).execute()
        for lang in LANGUAGES:
            item = languages[lang]
            client.table("lesson_localizations").insert(
                {
                    "bundle_id": bundle_id,
                    "language": lang,
                    "title": item["title"],
                    "lecture": item["lecture"],
                    "summary": item["summary"],
                    "glossary": item["glossary"],
                }
            ).execute()
            client.table("subtitle_tracks").insert(
                {
                    "bundle_id": bundle_id,
                    "language": lang,
                    "cues": item["cues"],
                    "vtt_text": item["vtt_text"],
                    "srt_text": item["srt_text"],
                }
            ).execute()
    except Exception as error:
        print(f"video draft persist skipped: {error}")
        return None
    return bundle_id


def _duration(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return None
    if duration <= 0 or duration > MAX_DURATION_SECONDS:
        return None
    return duration


def _lecture(payload: dict[str, Any]) -> dict[str, Any]:
    sections = []
    for section in (payload.get("sections") or [])[:40]:
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading") or "").strip()[:200]
        body = str(section.get("body") or "").strip()[:4000]
        if not heading and not body:
            continue
        item: dict[str, Any] = {"heading": heading, "body": body}
        try:
            start = float(section.get("start_seconds"))
            if start >= 0:
                item["start_seconds"] = round(start, 3)
        except (TypeError, ValueError):
            pass
        sections.append(item)
    return {
        "goals": _string_list(payload.get("goals"), 12, 300),
        "sections": sections,
        "definitions": _pairs(payload.get("definitions"), "term", "meaning", 40),
        "examples": _examples(payload.get("examples") or []),
        "self_check": [{"prompt": item} for item in _string_list(payload.get("self_check"), 8, 400)],
    }


def _cues(raw: Any, duration: float | None) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    cues: list[dict[str, Any]] = []
    for item in raw[:8000]:
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start") if item.get("start") is not None else item.get("start_seconds") or 0)
            end = float(item.get("end") if item.get("end") is not None else item.get("end_seconds") or 0)
        except (TypeError, ValueError):
            continue
        text = str(item.get("text") or "").strip()[:500]
        if not text or start < 0 or end <= start:
            continue
        if duration is not None and end > duration + 1:
            end = duration
        if end <= start:
            continue
        cue = {"start": round(start, 3), "end": round(end, 3), "text": text}
        if item.get("uncertain") is True:
            cue["uncertain"] = True
        cues.append(cue)
    return cues


def _glossary(raw: Any) -> list[dict[str, str]]:
    return _pairs(raw, "term", "meaning", 80)


def _pairs(raw: Any, left: str, right: str, limit: int) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    result: list[dict[str, str]] = []
    for item in raw[:limit]:
        if not isinstance(item, dict):
            continue
        term = str(item.get(left) or item.get("term") or "").strip()[:120]
        meaning = str(item.get(right) or item.get("meaning") or item.get("ru") or "").strip()[:500]
        if term and meaning:
            result.append({left: term, right: meaning})
    return result


def _examples(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw[:20]:
        if isinstance(item, str):
            text = item.strip()[:1000]
            if text:
                result.append({"text": text, "from_source": False})
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:1000]
        if text:
            result.append({"text": text, "from_source": bool(item.get("from_source"))})
    return result


def _string_list(raw: Any, limit: int, size: int) -> list[str]:
    if isinstance(raw, list):
        values = raw
    else:
        values = []
    result: list[str] = []
    for item in values[:limit]:
        if isinstance(item, dict):
            text = str(item.get("prompt") or item.get("text") or "").strip()[:size]
        else:
            text = str(item or "").strip()[:size]
        if text:
            result.append(text)
    return result


def _timestamp(seconds: float, *, srt: bool = False) -> str:
    millis = max(0, int(round(float(seconds) * 1000)))
    hours, rest = divmod(millis, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, milli = divmod(rest, 1000)
    sep = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{milli:03d}"
