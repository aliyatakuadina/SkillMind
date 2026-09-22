from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from skillmind_server.authoring import AuthoringError
from skillmind_server.data import DataAccess
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.video_bundle import LANGUAGES, sanitize_video_bundle, to_srt, to_vtt


def bundle_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "course_id": record["course_id"],
        "lesson_id": record["lesson_id"],
        "source_id": record.get("source_id"),
        "job_id": record.get("job_id"),
        "version_number": record.get("version_number") or 1,
        "content_revision": record.get("content_revision") or 1,
        "status": record.get("status") or "draft",
        "stale_at": record.get("stale_at"),
        "published": record.get("status") == "published",
        "youtube_id": record.get("youtube_id"),
        "duration_seconds": record.get("duration_seconds"),
        "languages": record.get("languages") or {},
    }


class BundleService:
    def __init__(self, data: DataAccess) -> None:
        self.data = data

    def persist_from_job(self, user: AuthUser, job_id: str) -> dict[str, Any]:
        job = self.data.get_job(job_id)
        if job is None or job.requested_by != user.id:
            raise ApiError(404, "AI_JOB_NOT_FOUND")
        if not job.lesson_id or not self.data.can_manage_lesson_write(user.token, job.lesson_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        if job.task_type != "video_bundle" or job.status != "needs_review" or not isinstance(job.output, dict):
            raise ApiError(400, "AI_INVALID_INPUT")
        languages_out = job.output.get("languages")
        if not isinstance(languages_out, dict) or any(lang not in languages_out for lang in LANGUAGES):
            raise ApiError(400, "AI_THREE_LANGUAGES_REQUIRED")
        existing = self.data.find_ai_bundle(lesson_id=job.lesson_id, job_id=job.id)
        if existing:
            return bundle_payload(existing)
        source = self.data.get_source(job.source_id) if job.source_id else None
        youtube_id = str((source.youtube_id if source else None) or job.output.get("youtube_id") or "")
        source_kind = "youtube" if youtube_id else str(job.output.get("source") or "file")
        try:
            languages = sanitize_video_bundle(
                job.output,
                youtube_id=youtube_id or None,
                duration_seconds=(source.duration_seconds if source else job.output.get("duration_seconds")),
                source=source_kind,
            )["languages"]
        except AuthoringError as error:
            raise ApiError(400, error.code) from error
        lesson = self.data.lesson_ref(job.lesson_id)
        try:
            record = self.data.create_ai_bundle(
                {
                    "id": str(uuid4()),
                    "course_id": job.course_id or (lesson.course_id if lesson else None),
                    "lesson_id": job.lesson_id,
                    "source_id": job.source_id,
                    "job_id": job.id,
                    "lesson_revision": lesson.lesson_revision if lesson else 1,
                    "source_revision": source.content_revision if source else None,
                    "status": "draft",
                    "youtube_id": youtube_id or None,
                    "duration_seconds": source.duration_seconds if source else job.output.get("duration_seconds"),
                    "languages": languages,
                }
            )
        except ApiError:
            raise
        except Exception as error:
            _raise_mapped(error)
        if job.output is not None:
            job.output = {**job.output, "bundle_id": record["id"]}
        return bundle_payload(record)

    def get_for_lesson(self, user: AuthUser, lesson_id: str) -> dict[str, Any]:
        if not self.data.can_manage_lesson_write(user.token, lesson_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        record = self.data.find_ai_bundle(lesson_id=lesson_id, status="draft") or self.data.find_ai_bundle(lesson_id=lesson_id)
        if record is None:
            raise ApiError(404, "AI_BUNDLE_NOT_FOUND")
        return bundle_payload(record)

    def get(self, user: AuthUser, bundle_id: str) -> dict[str, Any]:
        record = self._owned_draft(user, bundle_id, write=False)
        return bundle_payload(record)

    def save_draft(self, user: AuthUser, bundle_id: str, *, expected_revision: int, languages: dict[str, Any]) -> dict[str, Any]:
        record = self._owned_draft(user, bundle_id, write=True)
        if record.get("status") != "draft":
            raise ApiError(409, "AI_PUBLISHED_BUNDLE_IMMUTABLE")
        if int(record.get("content_revision") or 1) != int(expected_revision):
            raise ApiError(409, "AI_STALE_BUNDLE")
        youtube_id = str(record.get("youtube_id") or "")
        try:
            clean = sanitize_video_bundle(
                {"languages": languages},
                youtube_id=youtube_id or None,
                duration_seconds=record.get("duration_seconds"),
                source="youtube" if youtube_id else "file",
            )
        except AuthoringError as error:
            raise ApiError(400, error.code) from error
        try:
            updated = self.data.replace_ai_bundle_languages(bundle_id, clean["languages"])
        except ApiError:
            raise
        except Exception as error:
            _raise_mapped(error)
        return bundle_payload(updated)

    def publish(self, user: AuthUser, bundle_id: str, *, expected_revision: int) -> dict[str, Any]:
        record = self._owned_draft(user, bundle_id, write=True)
        if record.get("status") != "draft":
            raise ApiError(409, "AI_PUBLISHED_BUNDLE_IMMUTABLE")
        if int(record.get("content_revision") or 1) != int(expected_revision):
            raise ApiError(409, "AI_STALE_BUNDLE")
        if record.get("stale_at"):
            raise ApiError(409, "AI_SOURCE_REVISION_CONFLICT")
        lesson = self.data.lesson_ref(record["lesson_id"])
        if lesson is None or lesson.lesson_revision != record.get("lesson_revision"):
            raise ApiError(409, "AI_SOURCE_REVISION_CONFLICT")
        if record.get("source_id"):
            source = self.data.get_source(record["source_id"])
            if source is None or source.status != "ready" or source.content_revision != record.get("source_revision"):
                raise ApiError(409, "AI_SOURCE_REVISION_CONFLICT")
        if not self.data.is_admin(user.token) and not self.data.is_course_author(user.token, record["course_id"]):
            raise ApiError(403, "AI_AUTHOR_REVIEW_REQUIRED")
        _assert_publishable(record)
        now = datetime.now(timezone.utc).isoformat()
        try:
            updated = self.data.publish_ai_bundle(
                bundle_id,
                reviewed_by=user.id,
                reviewed_at=now,
                published_at=now,
            )
        except ApiError:
            raise
        except Exception as error:
            _raise_mapped(error)
        return bundle_payload(updated)

    def _owned_draft(self, user: AuthUser, bundle_id: str, *, write: bool) -> dict[str, Any]:
        record = self.data.get_ai_bundle(bundle_id)
        if record is None:
            raise ApiError(404, "AI_BUNDLE_NOT_FOUND")
        allowed = self.data.can_manage_lesson_write(user.token, record["lesson_id"])
        if write:
            if not allowed:
                raise ApiError(403, "AI_ACCESS_DENIED")
        elif not allowed and record.get("status") != "published":
            raise ApiError(403, "AI_ACCESS_DENIED")
        return record


def _assert_publishable(record: dict[str, Any]) -> None:
    languages = record.get("languages") or {}
    complete = 0
    tracks = 0
    for lang in LANGUAGES:
        item = languages.get(lang) or {}
        lecture = item.get("lecture") if isinstance(item.get("lecture"), dict) else {}
        summary = str(item.get("summary") or "").strip()
        if lecture and lecture != {} and summary:
            complete += 1
        cues = item.get("cues") or []
        vtt = str(item.get("vtt_text") or "")
        srt = str(item.get("srt_text") or "").strip()
        if cues and vtt.startswith("WEBVTT") and srt:
            tracks += 1
        elif cues:
            item["vtt_text"] = to_vtt(cues)
            item["srt_text"] = to_srt(cues)
            if item["vtt_text"].startswith("WEBVTT") and item["srt_text"].strip():
                tracks += 1
    if complete != 3:
        raise ApiError(400, "AI_THREE_LANGUAGES_REQUIRED")
    if record.get("source_id") and tracks != 3:
        raise ApiError(400, "AI_THREE_SUBTITLE_TRACKS_REQUIRED")


def _raise_mapped(error: Exception) -> None:
    message = str(error)
    for code, status in (
        ("AI_SOURCE_REVISION_CONFLICT", 409),
        ("AI_PUBLISHED_BUNDLE_IMMUTABLE", 409),
        ("AI_AUTHOR_REVIEW_REQUIRED", 403),
        ("AI_THREE_LANGUAGES_REQUIRED", 400),
        ("AI_THREE_SUBTITLE_TRACKS_REQUIRED", 400),
        ("AI_STALE_BUNDLE", 409),
        ("AI_BUNDLE_NOT_FOUND", 404),
    ):
        if code in message:
            raise ApiError(status, code) from error
    raise ApiError(400, "AI_INVALID_INPUT") from error
