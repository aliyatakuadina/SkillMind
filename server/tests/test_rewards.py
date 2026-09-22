from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from skillmind_server.api import create_app
from skillmind_server.data import LessonRef, MemoryData
from skillmind_server.errors import AuthUser
from skillmind_server.rewards import level_for_xp, week_start_on
from skillmind_server.settings import Settings
from skillmind_server.storage import MemoryStorage

TEACHER = AuthUser(id="00000000-0000-4000-8000-000000000001", token="teacher-token")
STUDENT = AuthUser(id="00000000-0000-4000-8000-000000000002", token="student-token")
STUDENT_B = AuthUser(id="00000000-0000-4000-8000-000000000003", token="student-b-token")
LESSON = LessonRef(
    course_id="00000000-0000-4000-8000-000000000010",
    lesson_id="00000000-0000-4000-8000-000000000030",
    course_revision=1,
    lesson_revision=1,
)


def make_client(user: AuthUser = STUDENT, *, gamification_enabled: bool = True):
    storage = MemoryStorage()
    data = MemoryData(teacher_id=TEACHER.id, lesson=LESSON)
    data.flags["gamification_enabled"] = gamification_enabled
    settings = Settings(
        _env_file=None,
        minio_access_key="test",
        minio_secret_key="test",
        gemini_api_key_1="",
    )
    app = create_app(settings, storage=storage, data=data, user=user)
    return TestClient(app), data


def test_level_formula():
    assert level_for_xp(0) == 1
    assert level_for_xp(199) == 1
    assert level_for_xp(200) == 2
    assert level_for_xp(400) == 3


def test_week_starts_monday_qyzylorda():
    # 2026-09-21 is Monday
    assert week_start_on(date(2026, 9, 21)) == date(2026, 9, 21)
    assert week_start_on(date(2026, 9, 24)) == date(2026, 9, 21)
    assert week_start_on(date(2026, 9, 20)) == date(2026, 9, 14)


def test_xp_disabled_by_flag():
    client, _data = make_client(gamification_enabled=False)
    response = client.post(
        "/v1/rewards/award",
        json={
            "event_type": "lesson_completed",
            "entity_id": LESSON.lesson_id,
            "course_id": LESSON.course_id,
        },
    )
    assert response.status_code == 403
    assert response.json()["error"] == "AI_FEATURE_DISABLED"


def test_first_lesson_awards_once_and_grants_achievement():
    client, _data = make_client()
    first = client.post(
        "/v1/rewards/award",
        json={
            "event_type": "lesson_completed",
            "entity_id": LESSON.lesson_id,
            "course_id": LESSON.course_id,
        },
    )
    assert first.status_code == 200
    body = first.json()
    assert body["created"] is True
    assert body["total_xp"] == 10
    assert body["level"] == 1

    second = client.post(
        "/v1/rewards/award",
        json={
            "event_type": "lesson_completed",
            "entity_id": LESSON.lesson_id,
            "course_id": LESSON.course_id,
        },
    )
    assert second.status_code == 200
    assert second.json()["created"] is False
    assert second.json()["total_xp"] == 10

    me = client.get("/v1/rewards/me").json()
    assert me["total_xp"] == 10
    assert any(item["achievement_code"] == "first_lesson" for item in me["achievements"])


def test_historical_xp_skips_weekly_board():
    client, data = make_client()
    client.post(f"/v1/rewards/courses/{LESSON.course_id}/ranking/join")
    awarded = client.post(
        "/v1/rewards/award",
        json={
            "event_type": "quiz_passed",
            "entity_id": "quiz-1",
            "course_id": LESSON.course_id,
            "historical": True,
        },
    )
    assert awarded.status_code == 200
    assert awarded.json()["total_xp"] == 25
    board = client.get(f"/v1/rewards/courses/{LESSON.course_id}/leaderboard").json()
    assert board["leaders"] == []
    assert data.week_scores_data == {}


def test_weekly_ranking_excludes_teacher_and_left_members():
    student_client, data = make_client(STUDENT)
    student_client.post(f"/v1/rewards/courses/{LESSON.course_id}/ranking/join")
    student_client.patch("/v1/rewards/preferences", json={"public_alias": "Айгерим"})
    student_client.post(
        "/v1/rewards/award",
        json={"event_type": "quiz_passed", "entity_id": "q1", "course_id": LESSON.course_id},
    )

    teacher_app = create_app(
        Settings(_env_file=None, minio_access_key="test", minio_secret_key="test"),
        storage=MemoryStorage(),
        data=data,
        user=TEACHER,
    )
    teacher_client = TestClient(teacher_app)
    denied = teacher_client.post(f"/v1/rewards/courses/{LESSON.course_id}/ranking/join")
    assert denied.status_code == 403

    board = student_client.get(f"/v1/rewards/courses/{LESSON.course_id}/leaderboard").json()
    assert board["leaders"][0]["alias"] == "Айгерим"
    assert board["leaders"][0]["xp"] == 25

    student_client.post(f"/v1/rewards/courses/{LESSON.course_id}/ranking/leave")
    hidden = student_client.get(f"/v1/rewards/courses/{LESSON.course_id}/leaderboard").json()
    assert hidden["leaders"] == []
    me = student_client.get("/v1/rewards/me").json()
    assert me["total_xp"] == 25
    assert any(item["achievement_code"] == "first_quiz" for item in me["achievements"])


def test_ten_lessons_achievement():
    client, _data = make_client()
    for index in range(10):
        client.post(
            "/v1/rewards/award",
            json={
                "event_type": "lesson_completed",
                "entity_id": f"lesson-{index}",
                "course_id": LESSON.course_id,
            },
        )
    me = client.get("/v1/rewards/me").json()
    assert me["total_xp"] == 100
    codes = {item["achievement_code"] for item in me["achievements"]}
    assert "ten_lessons" in codes
    assert "first_lesson" in codes


def test_goal_days_next_week_only():
    client, data = make_client()
    prefs = client.patch(
        "/v1/rewards/preferences",
        json={"weekly_goal_days": 2, "next_weekly_goal_days": 5},
    ).json()
    assert prefs["weekly_goal_days"] == 2
    assert prefs["next_weekly_goal_days"] == 5
    assert prefs["next_goal_effective_week"] == (week_start_on() + timedelta(days=7)).isoformat()
