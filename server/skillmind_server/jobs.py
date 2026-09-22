from __future__ import annotations

from skillmind_server.authoring import AUTHOR_TASKS
from skillmind_server.data import DataAccess
from skillmind_server.errors import ApiError, AuthUser


class JobService:
    def __init__(self, data: DataAccess) -> None:
        self.data = data

    def enqueue(
        self,
        user: AuthUser,
        *,
        task_type: str,
        idempotency_key: str,
        input_payload: dict,
        course_id: str | None = None,
        lesson_id: str | None = None,
        source_id: str | None = None,
    ) -> dict:
        if task_type not in {
            "course_structure",
            "lesson_summary",
            "quiz",
            "video_bundle",
            "translation",
            "chat",
            "embedding",
        }:
            raise ApiError(400, "AI_INVALID_INPUT")
        if task_type == "course_structure":
            if lesson_id or source_id or not course_id:
                raise ApiError(400, "AI_INVALID_SCOPE")
            if not self.data.is_course_author(user.token, course_id):
                raise ApiError(403, "AI_ACCESS_DENIED")
        elif lesson_id and not self.data.can_manage_lesson_write(user.token, lesson_id) and task_type != "chat":
            raise ApiError(403, "AI_ACCESS_DENIED")
        if lesson_id:
            lesson = self.data.lesson_ref(lesson_id)
            if lesson is None:
                raise ApiError(400, "AI_INVALID_SCOPE")
            course_id = course_id or lesson.course_id
            if course_id != lesson.course_id:
                raise ApiError(400, "AI_INVALID_SCOPE")
            course_revision = lesson.course_revision
            lesson_revision = lesson.lesson_revision
        elif course_id:
            course_revision = self.data.course_revision(course_id)
            if course_revision is None:
                raise ApiError(400, "AI_INVALID_SCOPE")
            lesson_revision = None
        else:
            course_revision = None
            lesson_revision = None
        source_revision = None
        if source_id:
            source = self.data.get_source(source_id)
            if source is None or source.lesson_id != lesson_id:
                raise ApiError(400, "AI_INVALID_SCOPE")
            if source.status != "ready":
                raise ApiError(409, "AI_STALE_SOURCE")
            source_revision = source.content_revision
        if task_type in AUTHOR_TASKS:
            input_payload = _author_input(task_type, input_payload)
        try:
            job = self.data.enqueue_job(
                p_requested_by=user.id,
                p_idempotency_key=idempotency_key,
                p_task_type=task_type,
                p_input=input_payload,
                p_course_id=course_id,
                p_course_revision=course_revision,
                p_lesson_id=lesson_id,
                p_lesson_revision=lesson_revision,
                p_source_id=source_id,
                p_source_revision=source_revision,
            )
        except Exception as error:
            message = str(error)
            for code in (
                "AI_FEATURE_DISABLED",
                "AI_ACCESS_DENIED",
                "AI_CONFIG_REQUIRED",
                "AI_IDEMPOTENCY_CONFLICT",
                "AI_STALE_COURSE",
                "AI_STALE_LESSON",
                "AI_STALE_SOURCE",
                "AI_INVALID_SCOPE",
                "AI_ASSESSMENT_ACTIVE",
            ):
                if code in message:
                    status = 409 if "STALE" in code or code == "AI_IDEMPOTENCY_CONFLICT" else 403 if "DENIED" in code or "DISABLED" in code or "ASSESSMENT" in code else 400
                    raise ApiError(status, code) from error
            raise ApiError(400, "AI_INVALID_INPUT") from error
        return job.__dict__

    def get(self, user: AuthUser, job_id: str) -> dict:
        job = self.data.get_job(job_id)
        if job is None or job.requested_by != user.id:
            raise ApiError(404, "AI_JOB_NOT_FOUND")
        return job.__dict__

    def cancel(self, user: AuthUser, job_id: str) -> dict:
        try:
            job = self.data.cancel_job(user.token, job_id)
        except Exception as error:
            if "AI_ACCESS_DENIED" in str(error):
                raise ApiError(403, "AI_ACCESS_DENIED") from error
            raise ApiError(400, "AI_INVALID_INPUT") from error
        return job.__dict__


def _author_input(task_type: str, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ApiError(400, "AI_INVALID_INPUT")
    if task_type == "course_structure":
        topic = str(payload.get("topic") or "").strip()
        if len(topic) < 3 or len(topic) > 300:
            raise ApiError(400, "AI_INVALID_INPUT")
        return {
            "topic": topic,
            "audience": str(payload.get("audience") or "").strip()[:300],
            "goals": str(payload.get("goals") or "").strip()[:1000],
            "duration": str(payload.get("duration") or "").strip()[:80],
        }
    content = str(payload.get("content") or "").strip()
    title = str(payload.get("title") or "").strip()[:300]
    if len(content) < 3 or len(content) > 12000:
        raise ApiError(400, "AI_INVALID_INPUT")
    result = {"title": title, "content": content}
    if task_type == "quiz":
        try:
            count = int(payload.get("count") or 5)
        except (TypeError, ValueError):
            count = 5
        result["count"] = min(10, max(1, count))
    return result
