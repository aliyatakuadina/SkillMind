from __future__ import annotations

import json

from skillmind_server.adapters import gemini_request_body
from skillmind_server.authoring import AuthoringError, parse_json_object
from skillmind_server.config_file import load_ai_config
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.settings import Settings
from skillmind_server.adapters import ProviderError
from skillmind_server.video_bundle import cue_windows, prompt_for_transcript_window, sanitize_video_bundle, to_vtt
from skillmind_server.worker import process_claim
from skillmind_server.youtube import parse_youtube_id

from test_api import LESSON, make_client, multipart_id_for


def sample_languages() -> dict:
    cue = {"start": 0, "end": 2.5, "text": "Привет"}
    lecture = {
        "goals": ["Понять тему"],
        "sections": [{"heading": "Введение", "body": "Текст", "start_seconds": 0}],
        "definitions": [{"term": "API", "meaning": "интерфейс"}],
        "examples": [{"text": "Пример", "from_source": False}],
        "self_check": [{"prompt": "Что это?"}],
    }
    return {
        "ru": {"title": "Урок", "summary": "Кратко о теме", "lecture": lecture, "cues": [cue], "glossary": [{"term": "API", "meaning": "интерфейс"}]},
        "kk": {"title": "Сабақ", "summary": "Тақырып туралы", "lecture": lecture, "cues": [{**cue, "text": "Сәлем"}], "glossary": [{"term": "API", "meaning": "интерфейс"}]},
        "en": {"title": "Lesson", "summary": "A short overview", "lecture": lecture, "cues": [{**cue, "text": "Hello"}], "glossary": [{"term": "API", "meaning": "interface"}]},
    }


def test_parse_youtube_urls():
    video_id = "dQw4w9WgXcQ"
    assert parse_youtube_id(video_id) == video_id
    assert parse_youtube_id(f"https://youtu.be/{video_id}?t=12") == video_id
    assert parse_youtube_id(f"https://www.youtube.com/watch?v={video_id}&list=xyz") == video_id
    assert parse_youtube_id(f"https://www.youtube.com/embed/{video_id}") == video_id
    assert parse_youtube_id(f"https://www.youtube.com/shorts/{video_id}") == video_id
    try:
        parse_youtube_id("https://vimeo.com/123")
        raise AssertionError("expected invalid")
    except ApiError as error:
        assert error.code == "YOUTUBE_ID_INVALID"


def test_sanitize_file_bundle_allows_missing_youtube():
    result = sanitize_video_bundle(
        {"languages": sample_languages(), "published": True},
        source="file",
        duration_seconds=60,
    )
    assert result["source"] == "file"
    assert result["youtube_id"] is None
    assert result["published"] is False


def test_sanitize_requires_three_languages_and_cues():
    result = sanitize_video_bundle(
        {"languages": sample_languages(), "passing_score": 99},
        youtube_id="dQw4w9WgXcQ",
        duration_seconds=60,
    )
    dumped = json.dumps(result)
    assert result["kind"] == "video_bundle"
    assert result["published"] is False
    assert "passing_score" not in dumped
    assert "WEBVTT" in result["languages"]["ru"]["vtt_text"]
    assert "00:00:00.000 --> 00:00:02.500" in to_vtt(result["languages"]["ru"]["cues"])
    missing = sample_languages()
    del missing["kk"]
    try:
        sanitize_video_bundle({"languages": missing}, youtube_id="dQw4w9WgXcQ", duration_seconds=60)
        raise AssertionError("expected invalid")
    except AuthoringError as error:
        assert error.code == "AI_INVALID_OUTPUT"


def test_gemini_youtube_parts():
    body = gemini_request_body("summarize", [{"file_data": {"file_uri": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}])
    parts = body["contents"][0]["parts"]
    assert parts[0]["file_data"]["file_uri"].endswith("dQw4w9WgXcQ")
    assert parts[1]["text"] == "summarize"
    assert body["generationConfig"]["responseMimeType"] == "application/json"


def test_youtube_register_enqueues_ready_source():
    client, _storage, data = make_client()
    client.app.state.media.youtube_probe = lambda _video_id: {"duration_seconds": 90, "title": "Demo"}
    response = client.post(
        "/v1/media/youtube",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "url": "https://youtu.be/dQw4w9WgXcQ",
            "idempotency_key": "00000000-0000-4000-8000-000000000090",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"]["source_kind"] == "youtube"
    assert body["source"]["status"] == "ready"
    assert body["source"]["youtube_id"] == "dQw4w9WgXcQ"
    assert body["source"]["duration_seconds"] == 90
    assert body["job"]["task_type"] == "video_bundle"
    assert data.get_source(body["source"]["id"]).youtube_id == "dQw4w9WgXcQ"


def test_invalid_and_forbidden_youtube():
    client, _storage, _data = make_client()
    client.app.state.media.youtube_probe = lambda _video_id: {"duration_seconds": 30, "title": "x"}
    bad = client.post(
        "/v1/media/youtube",
        json={"course_id": LESSON.course_id, "lesson_id": LESSON.lesson_id, "url": "https://example.com/watch"},
    )
    assert bad.status_code == 400
    assert bad.json()["error"] == "YOUTUBE_ID_INVALID"
    student, _storage, _data = make_client(AuthUser(id="student", token="student-token"))
    denied = student.post(
        "/v1/media/youtube",
        json={"course_id": LESSON.course_id, "lesson_id": LESSON.lesson_id, "url": "https://youtu.be/dQw4w9WgXcQ"},
    )
    assert denied.status_code == 403


def test_too_long_youtube_is_rejected():
    client, _storage, _data = make_client()
    client.app.state.media.youtube_probe = lambda _video_id: {"duration_seconds": 7201, "title": "long"}
    response = client.post(
        "/v1/media/youtube",
        json={"course_id": LESSON.course_id, "lesson_id": LESSON.lesson_id, "url": "dQw4w9WgXcQ"},
    )
    assert response.status_code == 400
    assert response.json()["error"] == "MEDIA_DURATION_UNSUPPORTED"


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.params: dict[str, dict] = {}
        self.history: list[tuple[str, dict]] = []

    def rpc(self, name, params):
        self.calls.append(name)
        self.params[name] = params
        self.history.append((name, params))
        return self

    def execute(self):
        return type("Result", (), {"data": None})()


def test_worker_youtube_needs_review_not_published():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)

    def caller(_candidate, _prompt):
        return json.dumps({"kind": "video_bundle", "languages": sample_languages(), "published": True})

    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000091", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "youtube", "youtube_id": "dQw4w9WgXcQ", "duration_seconds": 60},
            "config": config.raw,
            "steps": [],
        },
        settings=settings,
        caller=caller,
    )
    assert fake.calls == ["ai_heartbeat_job", "ai_checkpoint_step", "ai_finish_job"]
    output = fake.params["ai_finish_job"]["p_output"]
    assert fake.params["ai_finish_job"]["p_status"] == "needs_review"
    assert output["published"] is False
    assert output["languages"]["kk"]["title"] == "Сабақ"
    assert "WEBVTT" in output["languages"]["en"]["vtt_text"]


def test_worker_file_asr_keeps_transcript_times():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    prompts: list[str] = []

    def caller(_candidate, prompt):
        prompts.append(prompt)
        return json.dumps({"kind": "video_bundle", "languages": sample_languages(), "published": True})

    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {
                "id": "00000000-0000-4000-8000-000000000094",
                "task_type": "video_bundle",
                "source_id": "00000000-0000-4000-8000-000000000095",
            },
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file", "duration_seconds": 60},
            "config": config.raw,
            "steps": [],
        },
        settings=settings,
        caller=caller,
        audio_chunks=[{"index": 0, "start": 0, "end": 60, "audio": b"abc"}],
        chunk_transcriber=lambda _chunk: [{"start": 1.25, "end": 3.5, "text": "Привет"}],
        slide_notes=[{"time": 12, "text": "формула на слайде"}],
    )
    assert fake.params["ai_heartbeat_job"]["p_lease_seconds"] == 600
    assert fake.params["ai_finish_job"]["p_status"] == "needs_review"
    output = fake.params["ai_finish_job"]["p_output"]
    assert output["published"] is False
    assert output["source"] == "file"
    assert output["youtube_id"] is None
    assert output["languages"]["ru"]["cues"][0]["start"] == 1.25
    assert "00:00:01.250 --> 00:00:03.500" in output["languages"]["kk"]["vtt_text"]
    assert output["slides"] == [{"time": 12.0, "text": "формула на слайде"}]
    assert "формула на слайде" in prompts[0]
    keys = [params["p_step_key"] for name, params in fake.history if name == "ai_checkpoint_step"]
    assert keys == ["asr-plan", "asr:0", "cues:split", "slides", "lecture:ru", "translate:kk", "translate:en"]
    assert len(prompts) == 3
    assert "Russian lecture" in prompts[0]
    assert "Kazakh" in prompts[1]
    assert "English" in prompts[2]


def test_worker_file_skips_completed_chunk():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    seen: list[int] = []

    def transcriber(chunk):
        seen.append(int(chunk["index"]))
        raise ApiError(400, "MEDIA_AUDIO_MISSING")

    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000094", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file"},
            "config": config.raw,
            "steps": [
                {
                    "step_key": "asr:0",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 0, "end": 1, "text": "уже готово"}]},
                }
            ],
        },
        settings=settings,
        audio_chunks=[
            {"index": 0, "start": 0, "end": 600, "audio": b"a"},
            {"index": 1, "start": 598, "end": 610, "audio": b"b"},
        ],
        chunk_transcriber=transcriber,
    )
    assert seen == [1]
    assert fake.params["ai_finish_job"]["p_error_code"] == "MEDIA_AUDIO_MISSING"


def test_worker_file_defers_lecture_without_repeating_asr():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    def caller(_candidate, _prompt):
        raise ProviderError("rate_limited", http_status=429)

    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000094", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file"},
            "config": config.raw,
            "steps": [],
        },
        settings=settings,
        caller=caller,
        audio_chunks=[{"index": 0, "start": 0, "end": 12, "audio": b"abc"}],
        chunk_transcriber=lambda _chunk: [{"start": 0, "end": 2, "text": "Привет"}],
    )
    assert "ai_defer_job" in fake.calls
    assert "ai_finish_job" not in fake.calls
    keys = [params["p_step_key"] for name, params in fake.history if name == "ai_checkpoint_step"]
    assert keys == ["asr-plan", "asr:0", "cues:split", "slides"]


def test_worker_file_reuses_transcript_checkpoints():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    prompts: list[str] = []
    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000094", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file"},
            "config": config.raw,
            "steps": [
                {
                    "step_key": "asr-plan",
                    "status": "completed",
                    "checkpoint": {"duration": 60, "chunks": [{"index": 0, "start": 0, "end": 60}]},
                },
                {
                    "step_key": "asr:0",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 1.25, "end": 3.5, "text": "Привет"}]},
                },
                {
                    "step_key": "cues:split",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 1.25, "end": 3.5, "text": "Привет"}]},
                },
                {
                    "step_key": "slides",
                    "status": "completed",
                    "checkpoint": {"observations": [{"time": 12, "text": "формула на слайде"}]},
                },
            ],
        },
        settings=settings,
        caller=lambda _candidate, prompt: prompts.append(prompt) or json.dumps({"languages": sample_languages()}),
    )
    assert fake.params["ai_finish_job"]["p_status"] == "needs_review"
    assert fake.params["ai_finish_job"]["p_output"]["languages"]["en"]["cues"][0]["end"] == 3.5
    assert "формула на слайде" in prompts[0]
    keys = [params["p_step_key"] for name, params in fake.history if name == "ai_checkpoint_step"]
    assert keys == ["lecture:ru", "translate:kk", "translate:en"]
    assert len(prompts) == 3


def test_worker_file_reuses_translate_kk_when_en_missing():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    prompts: list[str] = []
    languages = sample_languages()
    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000094", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file"},
            "config": config.raw,
            "steps": [
                {
                    "step_key": "asr-plan",
                    "status": "completed",
                    "checkpoint": {"duration": 60, "chunks": [{"index": 0, "start": 0, "end": 60}]},
                },
                {
                    "step_key": "asr:0",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 1.25, "end": 3.5, "text": "Привет"}]},
                },
                {
                    "step_key": "cues:split",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 1.25, "end": 3.5, "text": "Привет"}]},
                },
                {
                    "step_key": "slides",
                    "status": "completed",
                    "checkpoint": {"observations": []},
                },
                {
                    "step_key": "lecture:ru",
                    "status": "completed",
                    "checkpoint": languages["ru"],
                },
                {
                    "step_key": "translate:kk",
                    "status": "completed",
                    "checkpoint": languages["kk"],
                },
            ],
        },
        settings=settings,
        caller=lambda _candidate, prompt: prompts.append(prompt) or json.dumps({"languages": languages}),
    )
    assert fake.params["ai_finish_job"]["p_status"] == "needs_review"
    assert fake.params["ai_finish_job"]["p_output"]["languages"]["kk"]["title"] == "Сабақ"
    assert fake.params["ai_finish_job"]["p_output"]["languages"]["en"]["cues"][0]["start"] == 1.25
    keys = [params["p_step_key"] for name, params in fake.history if name == "ai_checkpoint_step"]
    assert keys == ["translate:en"]
    assert len(prompts) == 1
    assert "English" in prompts[0]


def test_worker_file_defers_during_translate_without_finishing():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    calls = {"n": 0}

    def caller(_candidate, _prompt):
        calls["n"] += 1
        if calls["n"] == 1:
            return json.dumps({"languages": {"ru": sample_languages()["ru"]}})
        raise ProviderError("rate_limited", http_status=429)

    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000094", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file"},
            "config": config.raw,
            "steps": [
                {
                    "step_key": "asr-plan",
                    "status": "completed",
                    "checkpoint": {"duration": 12, "chunks": [{"index": 0, "start": 0, "end": 12}]},
                },
                {
                    "step_key": "asr:0",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 0, "end": 2, "text": "Привет"}]},
                },
                {
                    "step_key": "cues:split",
                    "status": "completed",
                    "checkpoint": {"cues": [{"start": 0, "end": 2, "text": "Привет"}]},
                },
                {
                    "step_key": "slides",
                    "status": "completed",
                    "checkpoint": {"observations": []},
                },
            ],
        },
        settings=settings,
        caller=caller,
    )
    assert "ai_defer_job" in fake.calls
    assert "ai_finish_job" not in fake.calls
    keys = [params["p_step_key"] for name, params in fake.history if name == "ai_checkpoint_step"]
    assert keys == ["lecture:ru"]
    assert "translate:kk" not in keys
    assert "translate:en" not in keys

def test_worker_file_without_storage_fails():
    settings = Settings(
        _env_file=None,
        gemini_api_key_1="gemini-secret-value",
        openai_api_key_1="x",
        litellm_api_key_1="y",
        minio_access_key="",
        minio_secret_key="",
    )
    config = load_ai_config(settings.config_path)
    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {
                "id": "00000000-0000-4000-8000-000000000096",
                "task_type": "video_bundle",
                "source_id": "00000000-0000-4000-8000-000000000097",
            },
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "file", "duration_seconds": 12},
            "config": config.raw,
            "steps": [],
        },
        settings=settings,
    )
    assert fake.params["ai_finish_job"]["p_status"] == "failed"
    assert fake.params["ai_finish_job"]["p_error_code"] == "MEDIA_STORAGE_UNAVAILABLE"


def test_worker_youtube_invalid_json_fails():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)
    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000092", "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"source": "youtube", "youtube_id": "dQw4w9WgXcQ", "duration_seconds": 60},
            "config": config.raw,
            "steps": [],
        },
        settings=settings,
        caller=lambda _candidate, _prompt: "not-json",
    )
    assert fake.params["ai_finish_job"]["p_status"] == "failed"
    assert fake.params["ai_finish_job"]["p_error_code"] == "AI_INVALID_OUTPUT"


def test_parse_json_object_still_used_for_fenced_video():
    payload = parse_json_object("```json\n" + json.dumps({"languages": sample_languages()}) + "\n```")
    result = sanitize_video_bundle(payload, youtube_id="dQw4w9WgXcQ", duration_seconds=12)
    assert result["languages"]["ru"]["cues"][0]["text"] == "Привет"


def _review_job(client, data):
    client.app.state.media.youtube_probe = lambda _video_id: {"duration_seconds": 90, "title": "Demo"}
    body = client.post(
        "/v1/media/youtube",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "url": "https://youtu.be/dQw4w9WgXcQ",
            "idempotency_key": "00000000-0000-4000-8000-000000000093",
        },
    ).json()
    job = data.get_job(body["job"]["id"])
    job.status = "needs_review"
    job.output = sanitize_video_bundle(
        {"languages": sample_languages()},
        youtube_id="dQw4w9WgXcQ",
        duration_seconds=90,
    )
    return body, job


def test_persist_save_and_publish_bundle():
    client, _storage, data = make_client()
    started, job = _review_job(client, data)
    first = client.post(f"/v1/jobs/{job.id}/bundle")
    assert first.status_code == 200
    bundle = first.json()
    assert bundle["status"] == "draft"
    assert bundle["published"] is False
    assert bundle["languages"]["kk"]["title"] == "Сабақ"
    assert client.post(f"/v1/jobs/{job.id}/bundle").json()["id"] == bundle["id"]

    languages = bundle["languages"]
    languages["ru"]["cues"][0]["text"] = "Исправленная реплика"
    languages["ru"]["summary"] = "Обновлённый конспект урока"
    saved = client.patch(
        f"/v1/ai-bundles/{bundle['id']}",
        json={"expected_revision": bundle["content_revision"], "languages": languages},
    )
    assert saved.status_code == 200
    assert saved.json()["languages"]["ru"]["cues"][0]["text"] == "Исправленная реплика"
    assert "Исправленная реплика" in saved.json()["languages"]["ru"]["vtt_text"]
    stale = client.patch(
        f"/v1/ai-bundles/{bundle['id']}",
        json={"expected_revision": bundle["content_revision"], "languages": languages},
    )
    assert stale.status_code == 409
    assert stale.json()["error"] == "AI_STALE_BUNDLE"

    denied = client.post(
        f"/v1/ai-bundles/{bundle['id']}/publish",
        json={"expected_revision": saved.json()["content_revision"], "confirmed": False},
    )
    assert denied.status_code == 400
    published = client.post(
        f"/v1/ai-bundles/{bundle['id']}/publish",
        json={"expected_revision": saved.json()["content_revision"], "confirmed": True},
    )
    assert published.status_code == 200, published.json()
    assert published.json()["status"] == "published"
    assert published.json()["published"] is True
    locked = client.patch(
        f"/v1/ai-bundles/{bundle['id']}",
        json={"expected_revision": published.json()["content_revision"], "languages": languages},
    )
    assert locked.status_code == 409
    assert locked.json()["error"] == "AI_PUBLISHED_BUNDLE_IMMUTABLE"
    lesson_bundle = client.get(f"/v1/lessons/{LESSON.lesson_id}/ai-bundle").json()
    assert lesson_bundle["id"] == bundle["id"]
    assert started["source"]["id"] == lesson_bundle["source_id"]


def test_persist_file_bundle_without_youtube():
    client, storage, data = make_client()
    started = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 3,
        },
    ).json()
    storage.put_part(multipart_id_for(storage, started["object_key"]), 1, b"abc")
    source_id = client.post(f"/v1/media/uploads/{started['upload_id']}/complete").json()["source"]["id"]
    queued = client.post(
        "/v1/jobs",
        json={
            "task_type": "video_bundle",
            "idempotency_key": "00000000-0000-4000-8000-000000000099",
            "input": {"source": "file", "duration_seconds": 1},
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "source_id": source_id,
        },
    )
    assert queued.status_code == 200
    job = data.get_job(queued.json()["id"])
    job.status = "needs_review"
    job.output = sanitize_video_bundle({"languages": sample_languages()}, source="file", duration_seconds=1)
    persisted = client.post(f"/v1/jobs/{job.id}/bundle")
    assert persisted.status_code == 200, persisted.json()
    body = persisted.json()
    assert body["youtube_id"] in {None, ""}
    assert body["status"] == "draft"
    assert body["languages"]["ru"]["title"] == "Урок"


def test_partial_job_cannot_persist_or_publish_bundle():
    client, storage, data = make_client()
    started = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 3,
        },
    ).json()
    storage.put_part(multipart_id_for(storage, started["object_key"]), 1, b"abc")
    source_id = client.post(f"/v1/media/uploads/{started['upload_id']}/complete").json()["source"]["id"]
    queued = client.post(
        "/v1/jobs",
        json={
            "task_type": "video_bundle",
            "idempotency_key": "00000000-0000-4000-8000-0000000000a1",
            "input": {"source": "file", "duration_seconds": 1},
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "source_id": source_id,
        },
    ).json()
    job = data.get_job(queued["id"])
    job.status = "waiting_provider"
    job.output = {"languages": {"ru": sample_languages()["ru"]}}
    assert client.post(f"/v1/jobs/{job.id}/bundle").status_code == 400
    job.status = "needs_review"
    denied = client.post(f"/v1/jobs/{job.id}/bundle")
    assert denied.status_code == 400
    assert denied.json()["error"] == "AI_THREE_LANGUAGES_REQUIRED"


def test_student_cannot_persist_or_publish_bundle():
    teacher, _storage, data = make_client()
    _started, job = _review_job(teacher, data)
    teacher.post(f"/v1/jobs/{job.id}/bundle")
    student, _storage, _data = make_client(AuthUser(id="student", token="student-token"))
    assert student.post(f"/v1/jobs/{job.id}/bundle").status_code in {403, 404}
    assert student.get(f"/v1/lessons/{LESSON.lesson_id}/ai-bundle").status_code == 403


def test_long_transcript_is_split_under_qwen_context():
    cues = [{"start": index, "end": index + 1, "text": "слово " * 80} for index in range(80)]
    windows = cue_windows(cues)
    assert len(windows) > 1
    for index, window in enumerate(windows, start=1):
        prompt = prompt_for_transcript_window(window, part=index, total=len(windows), duration_seconds=80)
        assert len(prompt) < 16000

