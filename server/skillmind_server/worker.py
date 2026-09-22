from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from supabase import create_client

from skillmind_server.adapters import Candidate, HttpCaller, ProviderError, complete_gemini
from skillmind_server.asr import (
    TranscriptDeferred,
    absolute_cues,
    assemble_cues,
    completed_checkpoint,
    extract_audio_chunk,
    plan_chunks,
    probe_media,
    public_chunk,
    save_object,
    split_long_cues,
    transcribe_chunk_audio,
)
from skillmind_server.authoring import AUTHOR_TASKS, PROFILE_BY_TASK, AuthoringError, parse_json_object, prompt_for, sanitize_author_output
from skillmind_server.config_file import load_ai_config, parse_ai_config
from skillmind_server.errors import ApiError
from skillmind_server.router import run_text
from skillmind_server.settings import Settings
from skillmind_server.slides import analyze_slides, extract_frames, sanitize_slide_notes
from skillmind_server.storage import MinioStorage
from skillmind_server.video_bundle import (
    extract_language_payload,
    lock_cue_timeline,
    lock_language_cues,
    persist_video_draft,
    prompt_for_transcript,
    prompt_for_translation,
    prompt_for_video,
    sanitize_language,
    sanitize_video_bundle,
)
from skillmind_server.youtube import YOUTUBE_ID, watch_url

TASK_TYPES = [
    "course_structure",
    "lesson_summary",
    "quiz",
    "video_bundle",
    "translation",
    "chat",
    "embedding",
]


def process_claim(
    client,
    claim: dict,
    _lease_seconds: int = 90,
    *,
    settings: Settings | None = None,
    caller: Callable[[Candidate, str], str] | None = None,
    storage=None,
    chunk_transcriber: Callable[[dict], list[dict]] | None = None,
    audio_chunks: list[dict] | None = None,
    slide_notes: list[dict] | None = None,
) -> None:
    job = claim["job"]
    task_type = job.get("task_type")
    if task_type in AUTHOR_TASKS:
        _process_author_job(client, claim, settings, caller)
        return
    payload = claim.get("input") or {}
    if task_type == "video_bundle" and (
        payload.get("source") in {"youtube", "file"}
        or payload.get("youtube_id")
        or job.get("source_id")
    ):
        _process_video_job(
            client,
            claim,
            settings,
            caller,
            storage,
            chunk_transcriber=chunk_transcriber,
            audio_chunks=audio_chunks,
            slide_notes=slide_notes,
        )
        return
    _finish_stub(client, claim)


def _process_author_job(client, claim: dict, settings: Settings | None, caller: Callable[[Candidate, str], str] | None) -> None:
    job = claim["job"]
    lease = claim["lease"]
    job_id = job["id"]
    token = lease["lease_token"]
    generation = lease["generation"]
    settings = settings or Settings()
    try:
        from skillmind_server.config_file import bind_litellm_url

        config = parse_ai_config(claim.get("config") or {}) if claim.get("config") else load_ai_config(settings.config_path)
        config = bind_litellm_url(config, settings.litellm_base_url)
    except Exception:
        _fail(client, job_id, token, generation, "AI_CONFIG_REQUIRED")
        return
    prompt = prompt_for(job.get("task_type"), claim.get("input") or {})
    complete = caller or (lambda candidate, text: HttpCaller().complete(candidate, text))
    result = run_text(
        config,
        settings.secret_map(),
        PROFILE_BY_TASK[job["task_type"]],
        prompt,
        complete,
    )
    if result.outcome == "waiting_provider":
        client.rpc(
            "ai_defer_job",
            {
                "p_job_id": job_id,
                "p_lease_token": token,
                "p_generation": generation,
                "p_delay_seconds": 60,
                "p_error_code": "AI_PROVIDER_UNAVAILABLE",
            },
        ).execute()
        return
    if result.outcome in {"refused", "invalid_input"} or not result.text:
        code = "AI_PROVIDER_REFUSED" if result.outcome == "refused" else "AI_INVALID_INPUT" if result.outcome == "invalid_input" else "AI_PROVIDER_UNAVAILABLE"
        _fail(client, job_id, token, generation, code)
        return
    try:
        output = sanitize_author_output(job["task_type"], parse_json_object(result.text))
    except AuthoringError as error:
        _fail(client, job_id, token, generation, error.code)
        return
    _checkpoint(
        client,
        job_id,
        token,
        generation,
        "generate",
        {"mode": "author", "provider": result.winner.provider if result.winner else None},
        90,
    )
    client.rpc(
        "ai_finish_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_status": "needs_review",
            "p_output": output,
        },
    ).execute()


def _process_video_job(
    client,
    claim: dict,
    settings: Settings | None,
    caller: Callable[[Candidate, str], str] | None,
    storage=None,
    chunk_transcriber: Callable[[dict], list[dict]] | None = None,
    audio_chunks: list[dict] | None = None,
    slide_notes: list[dict] | None = None,
) -> None:
    job = claim["job"]
    lease = claim["lease"]
    job_id = job["id"]
    token = lease["lease_token"]
    generation = lease["generation"]
    payload = claim.get("input") or {}
    youtube_id = _youtube_id(claim)
    source = "youtube" if youtube_id else "file"
    settings = settings or Settings()
    try:
        from skillmind_server.config_file import bind_litellm_url

        config = parse_ai_config(claim.get("config") or {}) if claim.get("config") else load_ai_config(settings.config_path)
        config = bind_litellm_url(config, settings.litellm_base_url)
    except Exception:
        _fail(client, job_id, token, generation, "AI_CONFIG_REQUIRED")
        return
    if source == "file":
        _process_file_job(
            client,
            claim,
            settings,
            config,
            caller,
            storage,
            chunk_transcriber,
            audio_chunks,
            slide_notes,
        )
        return
    _extend_lease(client, job_id, token, generation, 300)
    extra_parts = None
    if not caller and youtube_id:
        extra_parts = [{"file_data": {"file_uri": watch_url(youtube_id)}}]
    prompt = prompt_for_video(youtube_id=youtube_id, duration_seconds=_duration(payload.get("duration_seconds")), source=source)

    def complete(candidate: Candidate, text: str) -> str:
        if caller:
            return caller(candidate, text)
        if extra_parts and candidate.provider != "gemini":
            raise ProviderError("unavailable_model", detail="video_requires_gemini")
        return complete_gemini(
            candidate.base_url,
            candidate.api_key,
            candidate.model_id,
            text,
            extra_parts=extra_parts,
            timeout=300.0 if extra_parts else None,
        )

    result = run_text(config, settings.secret_map(), "video", prompt, complete)
    if result.outcome == "waiting_provider":
        client.rpc(
            "ai_defer_job",
            {
                "p_job_id": job_id,
                "p_lease_token": token,
                "p_generation": generation,
                "p_delay_seconds": 60,
                "p_error_code": "AI_PROVIDER_UNAVAILABLE",
            },
        ).execute()
        return
    if result.outcome in {"refused", "invalid_input"} or not result.text:
        code = "AI_PROVIDER_REFUSED" if result.outcome == "refused" else "AI_INVALID_INPUT" if result.outcome == "invalid_input" else "AI_PROVIDER_UNAVAILABLE"
        _fail(client, job_id, token, generation, code)
        return
    try:
        output = sanitize_video_bundle(
            parse_json_object(result.text),
            youtube_id=youtube_id,
            duration_seconds=_duration(payload.get("duration_seconds")),
            source=source,
        )
    except AuthoringError as error:
        _fail(client, job_id, token, generation, error.code)
        return
    bundle_id = persist_video_draft(client, job, output)
    if bundle_id:
        output["bundle_id"] = bundle_id
    _checkpoint(
        client,
        job_id,
        token,
        generation,
        "generate",
        {"mode": source, "provider": result.winner.provider if result.winner else None},
        90,
    )
    client.rpc(
        "ai_finish_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_status": "needs_review",
            "p_output": output,
        },
    ).execute()


def _process_file_job(
    client,
    claim: dict,
    settings: Settings,
    config,
    caller: Callable[[Candidate, str], str] | None,
    storage,
    chunk_transcriber: Callable[[dict], list[dict]] | None,
    audio_chunks: list[dict] | None,
    slide_notes: list[dict] | None,
) -> None:
    job = claim["job"]
    lease = claim["lease"]
    job_id = job["id"]
    token = lease["lease_token"]
    generation = lease["generation"]
    _extend_lease(client, job_id, token, generation, 600)
    temp: tempfile.TemporaryDirectory | None = None
    try:
        cues, duration, media_path, temp = _file_cues(
            client,
            claim,
            settings,
            config,
            storage,
            chunk_transcriber,
            audio_chunks,
            job_id,
            token,
            generation,
        )
        cues = _split_cues(client, claim, cues, job_id, token, generation)
        notes = _slide_observations(
            client,
            claim,
            settings,
            config,
            job_id,
            token,
            generation,
            media_path,
            duration,
            slide_notes,
        )
        complete = caller or (lambda candidate, text: HttpCaller().complete(candidate, text))
        languages = _file_languages(
            client,
            claim,
            settings,
            config,
            complete,
            cues,
            duration,
            notes,
            job_id,
            token,
            generation,
        )
        output = lock_cue_timeline(
            sanitize_video_bundle(
                {"languages": languages},
                duration_seconds=duration,
                source="file",
            ),
            cues,
        )
        output["slides"] = notes
    except TranscriptDeferred as error:
        _defer(client, job_id, token, generation, error.code)
        return
    except ApiError as error:
        _fail(client, job_id, token, generation, error.code)
        return
    except AuthoringError as error:
        _fail(client, job_id, token, generation, error.code)
        return
    finally:
        if temp is not None:
            temp.cleanup()
    bundle_id = persist_video_draft(client, job, output)
    if bundle_id:
        output["bundle_id"] = bundle_id
    client.rpc(
        "ai_finish_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_status": "needs_review",
            "p_output": output,
        },
    ).execute()


def _file_languages(
    client,
    claim: dict,
    settings: Settings,
    config,
    complete: Callable[[Candidate, str], str],
    cues: list[dict],
    duration: float,
    notes: list[dict],
    job_id: str,
    token: str,
    generation: int,
) -> dict[str, dict]:
    ru = completed_checkpoint(claim, "lecture:ru")
    if ru is None:
        _extend_lease(client, job_id, token, generation, 600)
        ru = _bounded_lecture(config, settings, complete, cues, duration, notes, "ru")
        _checkpoint(client, job_id, token, generation, "lecture:ru", ru, 90)

    languages: dict[str, dict] = {"ru": ru}
    for lang, progress in (("kk", 93), ("en", 96)):
        key = f"translate:{lang}"
        existing = completed_checkpoint(claim, key)
        if existing is not None:
            languages[lang] = existing
            continue
        _extend_lease(client, job_id, token, generation, 600)
        item = _bounded_translation(config, settings, complete, ru, lang, cues, duration)
        _checkpoint(client, job_id, token, generation, key, item, progress)
        languages[lang] = item
    return languages


def _bounded_lecture(config, settings, complete, cues, duration, notes, lang: str) -> dict:
    from skillmind_server.video_bundle import cue_windows, prompt_for_lecture_overview, prompt_for_transcript_window

    windows = cue_windows(cues)
    sections: list[dict] = []
    for index, window in enumerate(windows, start=1):
        parsed = _text_json(
            config,
            settings,
            "lecture",
            prompt_for_transcript_window(window, part=index, total=len(windows), duration_seconds=duration),
            complete,
        )
        for section in parsed.get("sections") or []:
            if isinstance(section, dict):
                sections.append(section)
    overview = _text_json(config, settings, "lecture", prompt_for_lecture_overview(sections, duration), complete)
    payload = {
        "title": overview.get("title") or "Лекция",
        "summary": overview.get("summary") or "Краткое содержание лекции по расшифровке.",
        "lecture": {
            "goals": overview.get("goals") or [],
            "sections": sections,
            "definitions": overview.get("definitions") or [],
            "examples": overview.get("examples") or [],
            "self_check": overview.get("self_check") or [],
        },
        "glossary": overview.get("glossary") or [],
        "cues": [{"start": cue["start"], "end": cue["end"], "text": cue.get("text") or ""} for cue in cues],
    }
    if notes:
        payload["lecture"]["examples"] = list(payload["lecture"]["examples"])
    return lock_language_cues(sanitize_language(extract_language_payload(payload, lang), duration_seconds=duration), cues)


def _bounded_translation(config, settings, complete, source: dict, lang: str, cues, duration) -> dict:
    from skillmind_server.video_bundle import cue_windows, prompt_for_text_batch

    target_name = "Kazakh (Cyrillic)" if lang == "kk" else "English"
    frame = _text_json(
        config,
        settings,
        "translation",
        prompt_for_text_batch(
            [
                str(source.get("title") or ""),
                str(source.get("summary") or ""),
                json.dumps(source.get("lecture") or {}, ensure_ascii=False)[:8000],
            ],
            target_name=target_name,
        ),
        complete,
    )
    lines = frame.get("lines") if isinstance(frame.get("lines"), list) else []
    title = str(lines[0]).strip() if lines else str(source.get("title") or "Лекция")
    summary = str(lines[1]).strip() if len(lines) > 1 else str(source.get("summary") or "")
    translated: list[str] = []
    for window in cue_windows([{"start": 0, "end": 0, "text": cue.get("text") or ""} for cue in cues]):
        batch = _text_json(
            config,
            settings,
            "translation",
            prompt_for_text_batch([str(cue.get("text") or "") for cue in window], target_name=target_name),
            complete,
        )
        batch_lines = batch.get("lines") if isinstance(batch.get("lines"), list) else []
        translated.extend(str(line) for line in batch_lines)
    cue_text = translated if len(translated) == len(cues) else [str(cue.get("text") or "") for cue in cues]
    payload = {
        "title": title or "Лекция",
        "summary": summary or "Перевод лекции.",
        "lecture": source.get("lecture") or {},
        "glossary": source.get("glossary") or [],
        "cues": [
            {"start": cue["start"], "end": cue["end"], "text": text or str(cue.get("text") or "")}
            for cue, text in zip(cues, cue_text)
        ],
    }
    return lock_language_cues(sanitize_language(payload, duration_seconds=duration), cues)


def _text_json(
    config,
    settings: Settings,
    profile: str,
    prompt: str,
    complete: Callable[[Candidate, str], str],
) -> dict:
    result = run_text(config, settings.secret_map(), profile, prompt, complete)
    if result.outcome == "waiting_provider":
        raise TranscriptDeferred()
    if result.outcome in {"refused", "invalid_input"} or not result.text:
        code = (
            "AI_PROVIDER_REFUSED"
            if result.outcome == "refused"
            else "AI_INVALID_INPUT"
            if result.outcome == "invalid_input"
            else "AI_PROVIDER_UNAVAILABLE"
        )
        raise ApiError(502, code)
    return parse_json_object(result.text)

def _file_cues(
    client,
    claim: dict,
    settings: Settings,
    config,
    storage,
    chunk_transcriber: Callable[[dict], list[dict]] | None,
    audio_chunks: list[dict] | None,
    job_id: str,
    token: str,
    generation: int,
) -> tuple[list[dict], float, str | None, tempfile.TemporaryDirectory | None]:
    plan_state = completed_checkpoint(claim, "asr-plan")
    audio_by_index: dict[int, bytes] = {}
    source_path: str | None = None
    temp: tempfile.TemporaryDirectory | None = None
    try:
        if audio_chunks is not None and plan_state is None:
            if not audio_chunks:
                raise ApiError(400, "MEDIA_UNREADABLE")
            listed = [public_chunk(item) for item in audio_chunks]
            audio_by_index = {int(item["index"]): item.get("audio") for item in audio_chunks}
            duration = max(float(item["end"]) for item in listed)
        elif plan_state and plan_state.get("chunks"):
            listed = [public_chunk(item) for item in plan_state["chunks"]]
            duration = float(plan_state.get("duration") or listed[-1]["end"])
        else:
            source_path, temp = _download_source(client, claim, settings, storage)
            info = probe_media(source_path)
            duration = float(info["duration_seconds"])
            listed = plan_chunks(duration)
        plan = {"duration": round(duration, 3), "chunks": listed}
        if plan_state is None:
            _checkpoint(client, job_id, token, generation, "asr-plan", plan, 15)
        stored: dict[str, list] = {}
        total = max(len(listed), 1)
        for offset, chunk in enumerate(listed):
            key = f"asr:{int(chunk['index'])}"
            existing = completed_checkpoint(claim, key)
            if existing is not None:
                stored[key] = list(existing.get("cues") or [])
                continue
            _extend_lease(client, job_id, token, generation, 600)
            if chunk_transcriber:
                relative = chunk_transcriber({**chunk, "audio": audio_by_index.get(int(chunk["index"]))})
            else:
                audio = audio_by_index.get(int(chunk["index"]))
                if not audio:
                    if source_path is None:
                        source_path, temp = _download_source(client, claim, settings, storage)
                    audio = extract_audio_chunk(source_path, float(chunk["start"]), float(chunk["end"]))
                relative = transcribe_chunk_audio(
                    config,
                    settings.secret_map(),
                    audio,
                    "audio/mpeg",
                    float(chunk["end"]) - float(chunk["start"]),
                )
            cues = absolute_cues(chunk, relative or [])
            progress = min(89, 20 + int(60 * (offset + 1) / total))
            _checkpoint(
                client,
                job_id,
                token,
                generation,
                key,
                {"cues": cues},
                progress,
                chunk_index=int(chunk["index"]),
            )
            stored[key] = cues
        merged = assemble_cues(listed, stored)
        if not merged:
            raise ApiError(400, "MEDIA_AUDIO_MISSING")
        return merged, duration, source_path, temp
    except Exception:
        if temp is not None:
            temp.cleanup()
        raise


def _split_cues(client, claim: dict, cues: list[dict], job_id: str, token: str, generation: int) -> list[dict]:
    existing = completed_checkpoint(claim, "cues:split")
    if existing is not None:
        return list(existing.get("cues") or cues)
    split = split_long_cues(cues)
    _checkpoint(client, job_id, token, generation, "cues:split", {"cues": split}, 18)
    return split


def _slide_observations(
    client,
    claim: dict,
    settings: Settings,
    config,
    job_id: str,
    token: str,
    generation: int,
    media_path: str | None,
    duration: float,
    slide_notes: list[dict] | None,
) -> list[dict]:
    existing = completed_checkpoint(claim, "slides")
    if existing is not None:
        return sanitize_slide_notes(existing.get("observations") or [])
    if slide_notes is not None:
        notes = sanitize_slide_notes(slide_notes)
    elif media_path:
        try:
            notes = analyze_slides(config, settings.secret_map(), extract_frames(media_path, duration))
        except (TranscriptDeferred, ApiError):
            notes = []
    else:
        notes = []
    _checkpoint(client, job_id, token, generation, "slides", {"observations": notes}, 88)
    return notes


def _download_source(client, claim: dict, settings: Settings, storage) -> tuple[str, tempfile.TemporaryDirectory]:
    store = storage or _storage_from_settings(settings)
    if store is None:
        raise ApiError(503, "MEDIA_STORAGE_UNAVAILABLE")
    object_key = _object_key(client, claim)
    if not object_key:
        raise ApiError(404, "MEDIA_SOURCE_NOT_FOUND")
    temp = tempfile.TemporaryDirectory()
    dest = Path(temp.name) / "source"
    try:
        save_object(store, object_key, dest)
    except Exception:
        temp.cleanup()
        raise
    return str(dest), temp


def _object_key(client, claim: dict) -> str | None:
    source_id = (claim.get("job") or {}).get("source_id")
    if not source_id or not hasattr(client, "table"):
        return None
    uploads = (
        client.table("media_uploads")
        .select("object_key,status")
        .eq("source_id", source_id)
        .eq("status", "completed")
        .limit(1)
        .execute()
    )
    rows = uploads.data or []
    if not rows:
        return None
    return rows[0].get("object_key")


def _storage_from_settings(settings: Settings):
    if not settings.media_configured:
        return None
    return MinioStorage(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        bucket=settings.minio_bucket,
        public_endpoint=settings.minio_public_endpoint,
        public_use_ssl=settings.minio_public_use_ssl,
        region=settings.minio_region,
    )


def _youtube_id(claim: dict) -> str | None:
    payload = claim.get("input") or {}
    video_id = str(payload.get("youtube_id") or "").strip()
    if payload.get("source") == "youtube" or video_id:
        return video_id if YOUTUBE_ID.fullmatch(video_id) else None
    return None


def _duration(value: Any) -> float | None:
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return None
    return duration if duration > 0 else None


def _extend_lease(client, job_id: str, token: str, generation: int, seconds: int) -> None:
    client.rpc(
        "ai_heartbeat_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_lease_seconds": seconds,
        },
    ).execute()


def _finish_stub(client, claim: dict) -> None:
    job = claim["job"]
    lease = claim["lease"]
    job_id = job["id"]
    token = lease["lease_token"]
    generation = lease["generation"]
    steps = claim.get("steps") or []
    completed = any(step.get("step_key") == "stub" and step.get("status") == "completed" for step in steps)
    if not completed:
        _checkpoint(client, job_id, token, generation, "stub", {"mode": "stub", "task_type": job.get("task_type")}, 90)
    client.rpc(
        "ai_finish_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_status": "completed",
            "p_output": {"mode": "stub", "task_type": job.get("task_type")},
        },
    ).execute()


def _checkpoint(
    client,
    job_id: str,
    token: str,
    generation: int,
    step_key: str,
    checkpoint: dict[str, Any],
    progress: int,
    *,
    chunk_index: int | None = None,
) -> None:
    params: dict[str, Any] = {
        "p_job_id": job_id,
        "p_lease_token": token,
        "p_generation": generation,
        "p_step_key": step_key,
        "p_status": "completed",
        "p_checkpoint": checkpoint,
        "p_progress": progress,
    }
    if chunk_index is not None:
        params["p_chunk_index"] = chunk_index
    client.rpc("ai_checkpoint_step", params).execute()


def _defer(client, job_id: str, token: str, generation: int, code: str = "AI_PROVIDER_UNAVAILABLE") -> None:
    client.rpc(
        "ai_defer_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_delay_seconds": 60,
            "p_error_code": code,
        },
    ).execute()


def _fail(client, job_id: str, token: str, generation: int, error_code: str) -> None:
    _checkpoint(client, job_id, token, generation, "generate", {"error": error_code}, 90)
    client.rpc(
        "ai_finish_job",
        {
            "p_job_id": job_id,
            "p_lease_token": token,
            "p_generation": generation,
            "p_status": "failed",
            "p_error_code": error_code,
        },
    ).execute()


def run_worker(settings: Settings | None = None) -> None:
    settings = settings or Settings()
    if settings.local_mode:
        from skillmind_server.local_pg import service_client

        client = service_client(settings)
    elif not settings.supabase_configured:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    else:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    storage = _storage_from_settings(settings)
    print(f"worker {settings.worker_id} polling")
    while True:
        try:
            claimed = client.rpc(
                "ai_claim_job",
                {
                    "p_worker_id": settings.worker_id,
                    "p_task_types": TASK_TYPES,
                    "p_lease_seconds": settings.worker_lease_seconds,
                },
            ).execute().data
            if not claimed:
                time.sleep(settings.worker_poll_seconds)
                continue
            process_claim(client, claimed, settings.worker_lease_seconds, settings=settings, storage=storage)
        except KeyboardInterrupt:
            raise
        except Exception as error:
            print(f"worker error: {error}")
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    run_worker()
