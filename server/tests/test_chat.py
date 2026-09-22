from __future__ import annotations

import json

from fastapi.testclient import TestClient

from skillmind_server.adapters import ProviderError
from skillmind_server.api import create_app
from skillmind_server.data import LessonRef, MemoryData
from skillmind_server.errors import AuthUser
from skillmind_server.indexing import EMBED_DIM
from skillmind_server.settings import Settings
from skillmind_server.storage import MemoryStorage

TEACHER = AuthUser(id="00000000-0000-4000-8000-000000000001", token="teacher-token")
STUDENT = AuthUser(id="00000000-0000-4000-8000-000000000002", token="student-token")
LESSON = LessonRef(
    course_id="00000000-0000-4000-8000-000000000010",
    lesson_id="00000000-0000-4000-8000-000000000030",
    course_revision=1,
    lesson_revision=1,
)


def _unit(seed: float = 0.1) -> list[float]:
    return [seed] * EMBED_DIM


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        minio_access_key="test",
        minio_secret_key="test",
        gemini_api_key_1="test-gemini",
        openai_api_key_1="",
        litellm_api_key_1="test-litellm",
    )


def _caller(candidate, prompt: str) -> str:
    try:
        payload = json.loads(prompt)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict) and "embed" in payload:
        texts = payload["embed"]
        return json.dumps([_unit(0.2)] * len(texts))
    return "Ответ по материалу урока. Источник: урок и таймкод 12."


def make_data(*, chat_enabled: bool = True) -> MemoryData:
    data = MemoryData(teacher_id=TEACHER.id, lesson=LESSON)
    data.flags["chat_enabled"] = chat_enabled
    return data


def make_client(user: AuthUser, data: MemoryData, caller=_caller):
    app = create_app(_settings(), storage=MemoryStorage(), data=data, user=user, caller=caller)
    return TestClient(app)


def _publish_bundle(data: MemoryData) -> str:
    bundle_id = "00000000-0000-4000-8000-000000000099"
    data.bundles[bundle_id] = {
        "id": bundle_id,
        "course_id": LESSON.course_id,
        "lesson_id": LESSON.lesson_id,
        "lesson_revision": 1,
        "status": "published",
        "languages": {
            "ru": {
                "title": "Введение",
                "summary": "Краткий обзор курса",
                "lecture": {"sections": [{"heading": "Тема", "body": "Основной материал лекции про векторный индекс"}]},
                "cues": [{"start": 12, "end": 20, "text": "Материал про индекс"}],
            },
            "kk": {
                "title": "Кіріспе",
                "summary": "Қысқаша",
                "lecture": {"sections": [{"heading": "Тақырып", "body": "Лекция мәтіні"}]},
                "cues": [{"start": 12, "end": 20, "text": "Индекс туралы"}],
            },
            "en": {
                "title": "Intro",
                "summary": "Overview",
                "lecture": {"sections": [{"heading": "Topic", "body": "Lecture body about the index"}]},
                "cues": [{"start": 12, "end": 20, "text": "About the index"}],
            },
        },
    }
    return bundle_id


def test_chat_disabled_by_flag():
    data = make_data(chat_enabled=False)
    client = make_client(STUDENT, data)
    response = client.post(
        "/v1/chat/ask",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "message": "Что в лекции?",
            "idempotency_key": "k1",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"] == "AI_FEATURE_DISABLED"


def test_index_and_chat_with_citations():
    data = make_data()
    bundle_id = _publish_bundle(data)
    teacher = make_client(TEACHER, data)
    indexed = teacher.post(f"/v1/ai-bundles/{bundle_id}/index")
    assert indexed.status_code == 200
    assert indexed.json()["chunks"] >= 3
    assert indexed.json()["dimensions"] == EMBED_DIM

    student = make_client(STUDENT, data)
    asked = student.post(
        "/v1/chat/ask",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "message": "query about index",
            "language": "ru",
            "idempotency_key": "ask-1",
        },
    )
    assert asked.status_code == 200
    body = asked.json()
    assert body["message"]["role"] == "assistant"
    assert body["message"]["citations"]
    assert body["message"]["content"]

    again = student.post(
        "/v1/chat/ask",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "message": "query about index",
            "language": "ru",
            "idempotency_key": "ask-1",
            "thread_id": body["thread_id"],
        },
    )
    assert again.status_code == 200
    assert again.json()["message"]["id"] == body["message"]["id"]

    thread = student.get(f"/v1/chat/threads/{body['thread_id']}")
    assert thread.status_code == 200
    assert len(thread.json()["messages"]) >= 2


def test_chat_blocked_during_quiz_attempt():
    data = make_data()
    data.quiz_blocked.add(STUDENT.token)
    client = make_client(STUDENT, data)
    response = client.post(
        "/v1/chat/ask",
        json={
            "course_id": LESSON.course_id,
            "message": "подскажи ответ теста",
            "idempotency_key": "quiz-1",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"] == "AI_ACCESS_DENIED"


def test_chat_empty_index_admits_missing_sources():
    data = make_data()

    def failing(candidate, prompt: str) -> str:
        try:
            payload = json.loads(prompt)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict) and "embed" in payload:
            return json.dumps([_unit()] * len(payload["embed"]))
        raise ProviderError("unavailable_model")

    version = data.create_index_version(
        {
            "id": "idx-empty",
            "course_id": LESSON.course_id,
            "provider": "gemini",
            "model_id": "gemini-embedding-001",
            "dimensions": EMBED_DIM,
            "status": "building",
        }
    )
    data.replace_course_chunks(version["id"], [])
    data.activate_index_version(version["id"], LESSON.course_id)
    client = make_client(STUDENT, data, caller=failing)
    response = client.post(
        "/v1/chat/ask",
        json={"course_id": LESSON.course_id, "message": "есть ли материал?", "idempotency_key": "empty-1"},
    )
    assert response.status_code == 200
    assert "Недостаточно" in response.json()["message"]["content"]
