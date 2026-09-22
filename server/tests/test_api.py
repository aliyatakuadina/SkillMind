from __future__ import annotations

from fastapi.testclient import TestClient

from skillmind_server.adapters import ProviderError
from skillmind_server.api import create_app
from skillmind_server.data import LessonRef, MemoryData
from skillmind_server.errors import AuthUser
from skillmind_server.settings import Settings
from skillmind_server.storage import MemoryStorage
from skillmind_server.worker import process_claim

TEACHER = AuthUser(id="00000000-0000-4000-8000-000000000001", token="teacher-token")
ADMIN = AuthUser(id="00000000-0000-4000-8000-000000000004", token="admin-token")
LESSON = LessonRef(
    course_id="00000000-0000-4000-8000-000000000010",
    lesson_id="00000000-0000-4000-8000-000000000030",
    course_revision=1,
    lesson_revision=1,
)


def make_client(user: AuthUser = TEACHER, **settings_fields):
    storage = MemoryStorage()
    data = MemoryData(teacher_id=TEACHER.id, lesson=LESSON)
    settings = Settings(
        _env_file=None,
        minio_access_key="test",
        minio_secret_key="test",
        litellm_base_url="http://127.0.0.1:9",
        gemini_api_key_1="",
        openai_api_key_1="",
        litellm_api_key_1="",
    )
    settings = settings.model_copy(update=settings_fields)
    app = create_app(settings, storage=storage, data=data, user=user)
    return TestClient(app), storage, data


def multipart_id_for(storage: MemoryStorage, object_key: str) -> str:
    for upload_id, key in storage.multipart_ids.items():
        if key == object_key:
            return upload_id
    raise AssertionError("missing multipart")


def test_health_does_not_expose_secrets():
    client, _storage, _data = make_client()
    body = client.get("/health/providers").json()
    assert body["gemini"]["configured"] is False
    assert body["openai"]["configured"] is False
    dumped = str(body)
    assert "sk-" not in dumped
    assert "AIza" not in dumped


def test_upload_requires_auth_when_no_fixed_user():
    app = create_app(
        Settings(_env_file=None),
        storage=MemoryStorage(),
        data=MemoryData(teacher_id=TEACHER.id, lesson=LESSON),
    )
    response = TestClient(app).post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 8_000_000,
        },
    )
    assert response.status_code == 401
    assert response.json()["error"] == "AI_AUTH_REQUIRED"


def test_student_cannot_init_upload():
    client, _storage, _data = make_client(AuthUser(id="student", token="student-token"))
    response = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 8_000_000,
        },
    )
    assert response.status_code == 403
    assert response.json()["error"] == "AI_ACCESS_DENIED"


def test_init_rejects_oversize_and_wrong_type():
    client, _storage, _data = make_client()
    too_big = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 3_000_000_000,
        },
    )
    assert too_big.json()["error"] == "MEDIA_SIZE_UNSUPPORTED"
    wrong_type = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "notes.pdf",
            "mime_type": "application/pdf",
            "expected_bytes": 1000,
        },
    )
    assert wrong_type.json()["error"] == "MEDIA_TYPE_UNSUPPORTED"


def test_multipart_resume_and_complete():
    client, storage, _data = make_client()
    started = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 8_000_000,
        },
    ).json()
    upload_id = started["upload_id"]
    part = client.post(f"/v1/media/uploads/{upload_id}/parts/1/url").json()
    assert part["method"] == "PUT"
    assert client.get(f"/v1/media/uploads/{upload_id}").json()["parts"] == []
    storage.put_part(multipart_id_for(storage, started["object_key"]), 1, b"video-bytes")
    resumed = client.get(f"/v1/media/uploads/{upload_id}").json()
    assert resumed["parts"][0]["PartNumber"] == 1
    completed = client.post(f"/v1/media/uploads/{upload_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["source"]["id"] == started["source_id"]
    assert completed.json()["source"]["status"] == "ready"


def test_enqueue_and_stub_worker():
    client, storage, _data = make_client()
    started = client.post(
        "/v1/media/uploads",
        json={
            "course_id": LESSON.course_id,
            "lesson_id": LESSON.lesson_id,
            "filename": "lecture.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": 1000,
        },
    ).json()
    storage.put_part(multipart_id_for(storage, started["object_key"]), 1, b"abc")
    source_id = client.post(f"/v1/media/uploads/{started['upload_id']}/complete").json()["source"]["id"]
    payload = {
        "task_type": "video_bundle",
        "idempotency_key": "00000000-0000-4000-8000-000000000080",
        "input": {"source": "file"},
        "course_id": LESSON.course_id,
        "lesson_id": LESSON.lesson_id,
        "source_id": source_id,
    }
    queued = client.post("/v1/jobs", json=payload)
    assert queued.status_code == 200
    job_id = queued.json()["id"]
    assert client.post("/v1/jobs", json=payload).json()["id"] == job_id

    class FakeClient:
        def __init__(self) -> None:
            self.calls: list[str] = []

        def rpc(self, name, _params):
            self.calls.append(name)
            return self

        def execute(self):
            return type("Result", (), {"data": None})()

    fake = FakeClient()
    process_claim(
        fake,
        {
            "job": {"id": job_id, "task_type": "video_bundle"},
            "lease": {"lease_token": "token", "generation": 1},
            "steps": [],
        },
        90,
    )
    assert fake.calls == ["ai_checkpoint_step", "ai_finish_job"]
    assert client.post(f"/v1/jobs/{job_id}/cancel").json()["status"] == "cancelled"


def test_teacher_cannot_open_admin_ai():
    client, _storage, _data = make_client()
    response = client.get("/v1/admin/ai")
    assert response.status_code == 403
    assert response.json()["error"] == "AI_ACCESS_DENIED"


def test_admin_overview_hides_secrets_and_keeps_flags_off():
    client, _storage, _data = make_client(
        ADMIN,
        gemini_api_key_1="gemini-secret-value",
        openai_api_key_1="openai-secret-value",
        litellm_api_key_1="litellm-secret-value",
    )
    body = client.get("/v1/admin/ai").json()
    dumped = str(body)
    assert "gemini-secret-value" not in dumped
    assert "openai-secret-value" not in dumped
    assert body["runtime"]["video_enabled"] is False
    assert body["runtime"]["author_tools_enabled"] is False
    assert body["runtime"]["chat_enabled"] is False
    assert body["connections"][0]["key_aliases"][0]["present"] is True
    lecture = body["profiles"]["lecture"]
    assert lecture[0]["provider"] == "litellm"
    assert lecture[0]["model_id"] == "qwen-chat"
    assert lecture[-1]["provider"] == "openai"
    assert "api_key" not in lecture[0]


def test_admin_probe_follows_litellm_then_gemini():
    def caller(candidate, _prompt):
        if candidate.provider == "litellm":
            raise ProviderError("rate_limited", http_status=429)
        return "OK"

    storage = MemoryStorage()
    data = MemoryData(teacher_id=TEACHER.id, lesson=LESSON)
    settings = Settings(
        _env_file=None,
        gemini_api_key_1="gemini-secret-value",
        openai_api_key_1="openai-secret-value",
        litellm_api_key_1="litellm-secret-value",
        litellm_base_url="http://127.0.0.1:9",
        minio_access_key="test",
        minio_secret_key="test",
    )
    app = create_app(settings, storage=storage, data=data, user=ADMIN, caller=caller)
    body = TestClient(app).post("/v1/admin/ai/probe", json={"profile": "lecture"}).json()
    assert body["outcome"] == "succeeded"
    assert body["text"] == "OK"
    assert body["winner"]["provider"] == "gemini"
    assert body["attempts"][0]["outcome"] == "rate_limited"
    assert "gemini-secret-value" not in str(body)


def test_activate_file_is_idempotent_for_the_same_hash():
    client, _storage, data = make_client(ADMIN)
    first = client.post("/v1/admin/ai/config/activate-file")
    assert first.status_code == 200
    second = client.post("/v1/admin/ai/config/activate-file").json()
    assert second["id"] == first.json()["id"]
    assert data.runtime["active_config_id"] == second["id"]
    assert len(data.configs) == 1


def test_catalog_refresh_seeds_yaml_models_without_keys():
    client, _storage, _data = make_client(ADMIN)
    body = client.post("/v1/admin/ai/catalog/refresh").json()
    assert body["updated"] >= 6
    model_ids = {item["model_id"] for item in body["catalog"]}
    assert "gemini-3.5-flash" in model_ids
    assert "gpt-4.1-mini" in model_ids


def test_student_cannot_enqueue_course_structure():
    client, _storage, _data = make_client(AuthUser(id="student", token="student-token"))
    response = client.post(
        "/v1/jobs",
        json={
            "task_type": "course_structure",
            "idempotency_key": "00000000-0000-4000-8000-000000000082",
            "input": {"topic": "Python для начинающих"},
            "course_id": LESSON.course_id,
        },
    )
    assert response.status_code == 403


def test_teacher_enqueues_course_structure_without_lesson():
    client, _storage, _data = make_client()
    response = client.post(
        "/v1/jobs",
        json={
            "task_type": "course_structure",
            "idempotency_key": "00000000-0000-4000-8000-000000000083",
            "input": {"topic": "Python для начинающих", "audience": "новички"},
            "course_id": LESSON.course_id,
        },
    )
    assert response.status_code == 200
    assert response.json()["task_type"] == "course_structure"
    assert response.json()["lesson_id"] is None
