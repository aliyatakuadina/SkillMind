from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4
import copy


@dataclass
class LessonRef:
    course_id: str
    lesson_id: str
    course_revision: int
    lesson_revision: int


@dataclass
class MediaSourceRecord:
    id: str
    course_id: str
    lesson_id: str
    created_by: str
    source_kind: str
    status: str
    content_revision: int
    mime_type: str | None = None
    byte_size: int | None = None
    duration_seconds: float | None = None
    content_sha256: str | None = None
    error_code: str | None = None
    youtube_id: str | None = None


@dataclass
class MediaUploadRecord:
    id: str
    source_id: str
    user_id: str
    bucket_name: str
    object_key: str
    multipart_upload_id: str | None
    expected_bytes: int
    part_size_bytes: int
    status: str
    expires_at: datetime


@dataclass
class JobRecord:
    id: str
    requested_by: str
    task_type: str
    status: str
    progress: int
    course_id: str | None = None
    lesson_id: str | None = None
    source_id: str | None = None
    error_code: str | None = None
    idempotency_key: str | None = None
    output: dict[str, Any] | None = None


class DataAccess(Protocol):
    def can_manage_lesson_write(self, token: str, lesson_id: str) -> bool: ...
    def lesson_ref(self, lesson_id: str) -> LessonRef | None: ...
    def create_source(self, source: MediaSourceRecord) -> MediaSourceRecord: ...
    def get_source(self, source_id: str) -> MediaSourceRecord | None: ...
    def update_source(self, source_id: str, **fields: Any) -> MediaSourceRecord: ...
    def create_upload(self, upload: MediaUploadRecord) -> MediaUploadRecord: ...
    def get_upload(self, upload_id: str) -> MediaUploadRecord | None: ...
    def update_upload(self, upload_id: str, **fields: Any) -> MediaUploadRecord: ...
    def enqueue_job(self, **fields: Any) -> JobRecord: ...
    def get_job(self, job_id: str) -> JobRecord | None: ...
    def cancel_job(self, token: str, job_id: str) -> JobRecord: ...
    def is_course_author(self, token: str, course_id: str) -> bool: ...
    def course_revision(self, course_id: str) -> int | None: ...
    def is_admin(self, token: str) -> bool: ...
    def get_runtime(self) -> dict[str, Any]: ...
    def list_config_versions(self) -> list[dict[str, Any]]: ...
    def insert_config_version(self, *, config: dict[str, Any], file_sha256: str, description: str, created_by: str | None) -> dict[str, Any]: ...
    def set_active_config(self, config_id: str) -> None: ...
    def list_catalog(self) -> list[dict[str, Any]]: ...
    def upsert_catalog(self, rows: list[dict[str, Any]]) -> None: ...
    def list_recent_jobs(self, limit: int = 50) -> list[dict[str, Any]]: ...
    def list_recent_attempts(self, limit: int = 100) -> list[dict[str, Any]]: ...
    def get_ai_bundle(self, bundle_id: str) -> dict[str, Any] | None: ...
    def find_ai_bundle(self, *, lesson_id: str, job_id: str | None = None, status: str | None = None) -> dict[str, Any] | None: ...
    def create_ai_bundle(self, record: dict[str, Any]) -> dict[str, Any]: ...
    def replace_ai_bundle_languages(self, bundle_id: str, languages: dict[str, Any]) -> dict[str, Any]: ...
    def publish_ai_bundle(self, bundle_id: str, *, reviewed_by: str, reviewed_at: str, published_at: str) -> dict[str, Any]: ...


class MemoryData:
    def __init__(self, *, teacher_id: str, lesson: LessonRef) -> None:
        self.teacher_id = teacher_id
        self.lesson = lesson
        self.sources: dict[str, MediaSourceRecord] = {}
        self.uploads: dict[str, MediaUploadRecord] = {}
        self.jobs: dict[str, JobRecord] = {}
        self.flags = {
            "video_enabled": False,
            "author_tools_enabled": False,
            "chat_enabled": False,
            "gamification_enabled": False,
        }
        self.runtime: dict[str, Any] = {"active_config_id": None}
        self.configs: list[dict[str, Any]] = []
        self.catalog: dict[tuple[str, str], dict[str, Any]] = {}
        self.attempts: list[dict[str, Any]] = []
        self.bundles: dict[str, dict[str, Any]] = {}
        self.index_versions: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, list[dict[str, Any]]] = {}
        self.chat_threads: dict[str, dict[str, Any]] = {}
        self.chat_messages: dict[str, list[dict[str, Any]]] = {}
        self.xp: list[dict[str, Any]] = []
        self.achievements: dict[tuple[str, str], dict[str, Any]] = {}
        self.preferences: dict[str, dict[str, Any]] = {}
        self.ranking: dict[tuple[str, str], dict[str, Any]] = {}
        self.week_scores_data: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.goals: dict[tuple[str, str], dict[str, Any]] = {}
        self.quiz_blocked: set[str] = set()

    def can_use_course_chat(self, token: str, course_id: str) -> bool:
        if course_id != self.lesson.course_id:
            return False
        return token not in self.quiz_blocked

    def create_index_version(self, record: dict[str, Any]) -> dict[str, Any]:
        self.index_versions[record["id"]] = copy.deepcopy(record)
        return copy.deepcopy(record)

    def replace_course_chunks(self, index_version_id: str, chunks: list[dict[str, Any]]) -> None:
        self.chunks[index_version_id] = copy.deepcopy(chunks)

    def activate_index_version(self, index_version_id: str, course_id: str) -> dict[str, Any]:
        for item in self.index_versions.values():
            if item.get("course_id") == course_id and item.get("status") == "active":
                item["status"] = "retired"
        current = self.index_versions[index_version_id]
        current["status"] = "active"
        return copy.deepcopy(current)

    def active_index_version(self, course_id: str) -> dict[str, Any] | None:
        for item in self.index_versions.values():
            if item.get("course_id") == course_id and item.get("status") == "active":
                return copy.deepcopy(item)
        return None

    def list_course_chunks(self, index_version_id: str, *, language: str | None = None) -> list[dict[str, Any]]:
        rows = self.chunks.get(index_version_id) or []
        if language:
            rows = [row for row in rows if row.get("language") == language]
        return copy.deepcopy(rows)

    def create_chat_thread(self, record: dict[str, Any]) -> dict[str, Any]:
        self.chat_threads[record["id"]] = copy.deepcopy(record)
        self.chat_messages[record["id"]] = []
        return copy.deepcopy(record)

    def get_chat_thread(self, thread_id: str) -> dict[str, Any] | None:
        row = self.chat_threads.get(thread_id)
        return copy.deepcopy(row) if row else None

    def create_chat_message(self, record: dict[str, Any]) -> dict[str, Any]:
        self.chat_messages.setdefault(record["thread_id"], []).append(copy.deepcopy(record))
        return copy.deepcopy(record)

    def find_chat_message(self, thread_id: str, idempotency_key: str, role: str) -> dict[str, Any] | None:
        for item in self.chat_messages.get(thread_id) or []:
            if item.get("idempotency_key") == idempotency_key and item.get("role") == role:
                return copy.deepcopy(item)
        return None

    def list_chat_messages(self, thread_id: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self.chat_messages.get(thread_id) or [])

    def find_xp(self, user_id: str, event_type: str, entity_id: str) -> dict[str, Any] | None:
        for item in self.xp:
            if item["user_id"] == user_id and item["event_type"] == event_type and item["entity_id"] == entity_id:
                return copy.deepcopy(item)
        return None

    def insert_xp(self, record: dict[str, Any]) -> dict[str, Any]:
        self.xp.append(copy.deepcopy(record))
        return copy.deepcopy(record)

    def total_xp(self, user_id: str) -> int:
        return sum(int(item["xp"]) for item in self.xp if item["user_id"] == user_id)

    def count_xp_events(self, user_id: str, event_type: str) -> int:
        return sum(1 for item in self.xp if item["user_id"] == user_id and item["event_type"] == event_type)

    def grant_achievement(self, user_id: str, code: str, ledger_id: str) -> None:
        key = (user_id, code)
        if key not in self.achievements:
            self.achievements[key] = {"user_id": user_id, "achievement_code": code, "source_ledger_id": ledger_id}

    def list_achievements(self, user_id: str) -> list[dict[str, Any]]:
        return [copy.deepcopy(item) for (uid, _), item in self.achievements.items() if uid == user_id]

    def get_preferences(self, user_id: str) -> dict[str, Any] | None:
        row = self.preferences.get(user_id)
        return copy.deepcopy(row) if row else None

    def upsert_preferences(self, user_id: str, record: dict[str, Any]) -> dict[str, Any]:
        stored = {**record, "user_id": user_id}
        self.preferences[user_id] = copy.deepcopy(stored)
        return copy.deepcopy(stored)

    def join_ranking(self, user_id: str, course_id: str) -> dict[str, Any]:
        key = (user_id, course_id)
        row = {"user_id": user_id, "course_id": course_id, "left_at": None}
        self.ranking[key] = row
        return copy.deepcopy(row)

    def leave_ranking(self, user_id: str, course_id: str) -> dict[str, Any]:
        key = (user_id, course_id)
        row = self.ranking.get(key) or {"user_id": user_id, "course_id": course_id}
        row["left_at"] = datetime.now(timezone.utc).isoformat()
        self.ranking[key] = row
        return copy.deepcopy(row)

    def is_ranking_member(self, user_id: str, course_id: str) -> bool:
        row = self.ranking.get((user_id, course_id))
        return bool(row and not row.get("left_at"))

    def add_week_score(self, course_id: str, week_start, user_id: str, xp: int) -> None:
        key = (course_id, str(week_start), user_id)
        current = self.week_scores_data.get(key) or {"course_id": course_id, "week_start": str(week_start), "user_id": user_id, "xp": 0}
        current["xp"] = int(current["xp"]) + int(xp)
        self.week_scores_data[key] = current

    def week_scores(self, course_id: str, week_start) -> list[dict[str, Any]]:
        rows = [row for row in self.week_scores_data.values() if row["course_id"] == course_id and row["week_start"] == str(week_start)]
        rows.sort(key=lambda item: (-int(item["xp"]), item["user_id"]))
        return copy.deepcopy(rows)

    def mark_goal_day(self, user_id: str, week_start, day, target: int) -> None:
        key = (user_id, str(week_start))
        row = self.goals.get(key) or {"user_id": user_id, "week_start": str(week_start), "target_days": target, "active_days": []}
        days = list(row.get("active_days") or [])
        stamp = str(day)
        if stamp not in days:
            days.append(stamp)
        row["active_days"] = days
        row["target_days"] = target
        newly_completed = False
        if len(days) >= target and not row.get("completed_at"):
            row["completed_at"] = datetime.now(timezone.utc).isoformat()
            newly_completed = True
        self.goals[key] = row
        if newly_completed:
            completed = sum(1 for item in self.goals.values() if item.get("user_id") == user_id and item.get("completed_at"))
            if completed >= 3:
                self.grant_achievement(user_id, "three_weekly_goals", self.xp[-1]["id"] if self.xp else str(uuid4()))

    def can_manage_lesson_write(self, token: str, lesson_id: str) -> bool:
        return token != "student-token" and lesson_id == self.lesson.lesson_id

    def is_course_author(self, token: str, course_id: str) -> bool:
        return token != "student-token" and course_id == self.lesson.course_id

    def course_revision(self, course_id: str) -> int | None:
        return self.lesson.course_revision if course_id == self.lesson.course_id else None

    def lesson_ref(self, lesson_id: str) -> LessonRef | None:
        return self.lesson if lesson_id == self.lesson.lesson_id else None

    def create_source(self, source: MediaSourceRecord) -> MediaSourceRecord:
        self.sources[source.id] = source
        return source

    def get_source(self, source_id: str) -> MediaSourceRecord | None:
        return self.sources.get(source_id)

    def update_source(self, source_id: str, **fields: Any) -> MediaSourceRecord:
        current = self.sources[source_id]
        updated = MediaSourceRecord(**{**current.__dict__, **fields})
        self.sources[source_id] = updated
        return updated

    def create_upload(self, upload: MediaUploadRecord) -> MediaUploadRecord:
        self.uploads[upload.id] = upload
        return upload

    def get_upload(self, upload_id: str) -> MediaUploadRecord | None:
        return self.uploads.get(upload_id)

    def update_upload(self, upload_id: str, **fields: Any) -> MediaUploadRecord:
        current = self.uploads[upload_id]
        allowed = {key: value for key, value in fields.items() if key in current.__dataclass_fields__}
        updated = MediaUploadRecord(**{**current.__dict__, **allowed})
        self.uploads[upload_id] = updated
        return updated

    def enqueue_job(self, **fields: Any) -> JobRecord:
        job = JobRecord(
            id=str(uuid4()),
            requested_by=fields.get("requested_by") or fields["p_requested_by"],
            task_type=fields.get("task_type") or fields["p_task_type"],
            status="queued",
            progress=0,
            course_id=fields.get("course_id") or fields.get("p_course_id"),
            lesson_id=fields.get("lesson_id") or fields.get("p_lesson_id"),
            source_id=fields.get("source_id") or fields.get("p_source_id"),
            idempotency_key=fields.get("idempotency_key") or fields.get("p_idempotency_key"),
        )
        existing = next((item for item in self.jobs.values() if item.idempotency_key == job.idempotency_key), None)
        if existing:
            return existing
        self.jobs[job.id] = job
        return job

    def get_job(self, job_id: str) -> JobRecord | None:
        return self.jobs.get(job_id)

    def cancel_job(self, token: str, job_id: str) -> JobRecord:
        job = self.jobs[job_id]
        job.status = "cancelled"
        return job

    def is_admin(self, token: str) -> bool:
        return token == "admin-token"

    def get_runtime(self) -> dict[str, Any]:
        return {**self.flags, **self.runtime}

    def list_config_versions(self) -> list[dict[str, Any]]:
        return list(self.configs)

    def insert_config_version(self, *, config: dict[str, Any], file_sha256: str, description: str, created_by: str | None) -> dict[str, Any]:
        row = {
            "id": str(uuid4()),
            "version_number": len(self.configs) + 1,
            "config": config,
            "file_sha256": file_sha256,
            "description": description,
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.configs.insert(0, row)
        return row

    def set_active_config(self, config_id: str) -> None:
        self.runtime["active_config_id"] = config_id

    def list_catalog(self) -> list[dict[str, Any]]:
        return list(self.catalog.values())

    def upsert_catalog(self, rows: list[dict[str, Any]]) -> None:
        for row in rows:
            key = (str(row["connection_slug"]), str(row["model_id"]))
            current = self.catalog.get(key, {"id": str(uuid4())})
            self.catalog[key] = {**current, **row}

    def list_recent_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        return [job.__dict__ for job in list(self.jobs.values())[-limit:][::-1]]

    def list_recent_attempts(self, limit: int = 100) -> list[dict[str, Any]]:
        return list(self.attempts)[:limit]

    def get_ai_bundle(self, bundle_id: str) -> dict[str, Any] | None:
        record = self.bundles.get(bundle_id)
        return copy.deepcopy(record) if record else None

    def find_ai_bundle(self, *, lesson_id: str, job_id: str | None = None, status: str | None = None) -> dict[str, Any] | None:
        items = [item for item in self.bundles.values() if item["lesson_id"] == lesson_id]
        if job_id:
            items = [item for item in items if item.get("job_id") == job_id]
        if status:
            items = [item for item in items if item.get("status") == status]
        items.sort(key=lambda item: int(item.get("version_number") or 0), reverse=True)
        return copy.deepcopy(items[0]) if items else None

    def create_ai_bundle(self, record: dict[str, Any]) -> dict[str, Any]:
        version = 1 + max(
            (int(item.get("version_number") or 0) for item in self.bundles.values() if item["lesson_id"] == record["lesson_id"]),
            default=0,
        )
        stored = {
            **copy.deepcopy(record),
            "version_number": record.get("version_number") or version,
            "content_revision": record.get("content_revision") or 1,
            "status": record.get("status") or "draft",
            "stale_at": record.get("stale_at"),
            "reviewed_by": record.get("reviewed_by"),
            "reviewed_at": record.get("reviewed_at"),
            "published_at": record.get("published_at"),
        }
        self.bundles[stored["id"]] = stored
        return copy.deepcopy(stored)

    def replace_ai_bundle_languages(self, bundle_id: str, languages: dict[str, Any]) -> dict[str, Any]:
        current = self.bundles[bundle_id]
        current["languages"] = copy.deepcopy(languages)
        current["content_revision"] = int(current.get("content_revision") or 1) + 1
        return copy.deepcopy(current)

    def publish_ai_bundle(self, bundle_id: str, *, reviewed_by: str, reviewed_at: str, published_at: str) -> dict[str, Any]:
        current = self.bundles[bundle_id]
        for item in self.bundles.values():
            if item["id"] != bundle_id and item["lesson_id"] == current["lesson_id"] and item.get("status") == "published":
                item["status"] = "archived"
                item["content_revision"] = int(item.get("content_revision") or 1) + 1
        current["status"] = "published"
        current["reviewed_by"] = reviewed_by
        current["reviewed_at"] = reviewed_at
        current["published_at"] = published_at
        current["content_revision"] = int(current.get("content_revision") or 1) + 1
        return copy.deepcopy(current)


class SupabaseData:
    def __init__(self, service, user_factory) -> None:
        self.service = service
        self.user_factory = user_factory

    def can_manage_lesson_write(self, token: str, lesson_id: str) -> bool:
        result = self.user_factory(token).rpc("can_manage_lesson_write", {"p_lesson_id": lesson_id}).execute()
        return bool(result.data)

    def is_course_author(self, token: str, course_id: str) -> bool:
        result = self.user_factory(token).rpc("is_course_author", {"p_course_id": course_id}).execute()
        return bool(result.data)

    def course_revision(self, course_id: str) -> int | None:
        rows = self.service.table("courses").select("id,content_revision").eq("id", course_id).limit(1).execute().data or []
        return rows[0]["content_revision"] if rows else None

    def lesson_ref(self, lesson_id: str) -> LessonRef | None:
        lessons = self.service.table("lessons").select("id,content_revision,module_id").eq("id", lesson_id).limit(1).execute().data or []
        if not lessons:
            return None
        lesson = lessons[0]
        modules = self.service.table("modules").select("id,course_id").eq("id", lesson["module_id"]).limit(1).execute().data or []
        if not modules:
            return None
        courses = self.service.table("courses").select("id,content_revision").eq("id", modules[0]["course_id"]).limit(1).execute().data or []
        if not courses:
            return None
        return LessonRef(
            course_id=courses[0]["id"],
            lesson_id=lesson["id"],
            course_revision=courses[0]["content_revision"],
            lesson_revision=lesson["content_revision"],
        )

    def create_source(self, source: MediaSourceRecord) -> MediaSourceRecord:
        payload = {
            "id": source.id,
            "course_id": source.course_id,
            "lesson_id": source.lesson_id,
            "created_by": source.created_by,
            "source_kind": source.source_kind,
            "status": source.status,
            "mime_type": source.mime_type,
            "byte_size": source.byte_size,
            "youtube_id": source.youtube_id,
        }
        if source.duration_seconds is not None:
            payload["duration_seconds"] = source.duration_seconds
        if source.content_sha256:
            payload["content_sha256"] = source.content_sha256
        row = self.service.table("media_sources").insert(payload).execute().data[0]
        return self._source(row)

    def get_source(self, source_id: str) -> MediaSourceRecord | None:
        rows = self.service.table("media_sources").select("*").eq("id", source_id).limit(1).execute().data or []
        return self._source(rows[0]) if rows else None

    def update_source(self, source_id: str, **fields: Any) -> MediaSourceRecord:
        row = self.service.table("media_sources").update(fields).eq("id", source_id).execute().data[0]
        return self._source(row)

    def create_upload(self, upload: MediaUploadRecord) -> MediaUploadRecord:
        payload = {
            "id": upload.id,
            "source_id": upload.source_id,
            "user_id": upload.user_id,
            "bucket_name": upload.bucket_name,
            "object_key": upload.object_key,
            "multipart_upload_id": upload.multipart_upload_id,
            "expected_bytes": upload.expected_bytes,
            "part_size_bytes": upload.part_size_bytes,
            "status": upload.status,
            "expires_at": upload.expires_at.isoformat(),
        }
        row = self.service.table("media_uploads").insert(payload).execute().data[0]
        return self._upload(row)

    def get_upload(self, upload_id: str) -> MediaUploadRecord | None:
        rows = self.service.table("media_uploads").select("*").eq("id", upload_id).limit(1).execute().data or []
        return self._upload(rows[0]) if rows else None

    def update_upload(self, upload_id: str, **fields: Any) -> MediaUploadRecord:
        payload = dict(fields)
        if "expires_at" in payload and hasattr(payload["expires_at"], "isoformat"):
            payload["expires_at"] = payload["expires_at"].isoformat()
        if "completed_at" in payload and hasattr(payload["completed_at"], "isoformat"):
            payload["completed_at"] = payload["completed_at"].isoformat()
        row = self.service.table("media_uploads").update(payload).eq("id", upload_id).execute().data[0]
        return self._upload(row)

    def enqueue_job(self, **fields: Any) -> JobRecord:
        result = self.service.rpc("ai_enqueue_job", fields).execute()
        return self._job(result.data)

    def get_job(self, job_id: str) -> JobRecord | None:
        rows = self.service.table("ai_jobs").select("*").eq("id", job_id).limit(1).execute().data or []
        if not rows:
            return None
        job = self._job(rows[0])
        payloads = self.service.table("ai_job_payloads").select("output").eq("job_id", job_id).limit(1).execute().data or []
        if payloads:
            job.output = payloads[0].get("output")
        return job

    def cancel_job(self, token: str, job_id: str) -> JobRecord:
        result = self.user_factory(token).rpc("cancel_ai_job", {"p_job_id": job_id}).execute()
        return self._job(result.data)

    def is_admin(self, token: str) -> bool:
        return bool(self.user_factory(token).rpc("is_admin").execute().data)

    def get_runtime(self) -> dict[str, Any]:
        rows = self.service.table("ai_runtime_settings").select("*").eq("singleton", True).limit(1).execute().data or []
        return rows[0] if rows else {}

    def list_config_versions(self) -> list[dict[str, Any]]:
        return (
            self.service.table("ai_config_versions")
            .select("id,version_number,file_sha256,description,created_at,created_by")
            .order("version_number", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )

    def insert_config_version(self, *, config: dict[str, Any], file_sha256: str, description: str, created_by: str | None) -> dict[str, Any]:
        payload = {"config": config, "file_sha256": file_sha256, "description": description}
        if created_by:
            payload["created_by"] = created_by
        return self.service.table("ai_config_versions").insert(payload).execute().data[0]

    def set_active_config(self, config_id: str) -> None:
        self.service.table("ai_runtime_settings").update(
            {"active_config_id": config_id, "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("singleton", True).execute()

    def list_catalog(self) -> list[dict[str, Any]]:
        return self.service.table("ai_model_catalog").select("*").order("provider").execute().data or []

    def upsert_catalog(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self.service.table("ai_model_catalog").upsert(rows, on_conflict="connection_slug,model_id").execute()

    def list_recent_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        return (
            self.service.table("ai_jobs")
            .select("id,task_type,status,progress,error_code,created_at,requested_by,lesson_id")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )

    def list_recent_attempts(self, limit: int = 100) -> list[dict[str, Any]]:
        return (
            self.service.table("ai_attempts")
            .select(
                "id,job_id,attempt_number,connection_slug,provider,key_alias,quota_group,model_id,outcome,http_status,started_at,finished_at"
            )
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )

    def get_ai_bundle(self, bundle_id: str) -> dict[str, Any] | None:
        rows = self.service.table("lesson_ai_bundles").select("*").eq("id", bundle_id).limit(1).execute().data or []
        if not rows:
            return None
        return self._bundle(rows[0])

    def find_ai_bundle(self, *, lesson_id: str, job_id: str | None = None, status: str | None = None) -> dict[str, Any] | None:
        query = self.service.table("lesson_ai_bundles").select("id").eq("lesson_id", lesson_id)
        if job_id:
            query = query.eq("job_id", job_id)
        if status:
            query = query.eq("status", status)
        rows = query.order("version_number", desc=True).limit(1).execute().data or []
        return self.get_ai_bundle(rows[0]["id"]) if rows else None

    def create_ai_bundle(self, record: dict[str, Any]) -> dict[str, Any]:
        existing = (
            self.service.table("lesson_ai_bundles")
            .select("version_number")
            .eq("lesson_id", record["lesson_id"])
            .order("version_number", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        version = int(existing[0]["version_number"]) + 1 if existing else 1
        payload = {
            "id": record["id"],
            "course_id": record["course_id"],
            "lesson_id": record["lesson_id"],
            "source_id": record.get("source_id"),
            "job_id": record.get("job_id"),
            "version_number": record.get("version_number") or version,
            "lesson_revision": record.get("lesson_revision") or 1,
            "source_revision": record.get("source_revision"),
            "status": record.get("status") or "draft",
        }
        self.service.table("lesson_ai_bundles").insert(payload).execute()
        self._write_languages(record["id"], record.get("languages") or {})
        loaded = self.get_ai_bundle(record["id"])
        if loaded is None:
            raise RuntimeError("AI_BUNDLE_NOT_FOUND")
        return loaded

    def replace_ai_bundle_languages(self, bundle_id: str, languages: dict[str, Any]) -> dict[str, Any]:
        self._write_languages(bundle_id, languages, update=True)
        loaded = self.get_ai_bundle(bundle_id)
        if loaded is None:
            raise RuntimeError("AI_BUNDLE_NOT_FOUND")
        return loaded

    def publish_ai_bundle(self, bundle_id: str, *, reviewed_by: str, reviewed_at: str, published_at: str) -> dict[str, Any]:
        current = self.get_ai_bundle(bundle_id)
        if current is None:
            raise RuntimeError("AI_BUNDLE_NOT_FOUND")
        self.service.table("lesson_ai_bundles").update({"status": "archived"}).eq("lesson_id", current["lesson_id"]).eq(
            "status", "published"
        ).execute()
        self.service.table("lesson_ai_bundles").update(
            {
                "status": "published",
                "reviewed_by": reviewed_by,
                "reviewed_at": reviewed_at,
                "published_at": published_at,
            }
        ).eq("id", bundle_id).execute()
        loaded = self.get_ai_bundle(bundle_id)
        if loaded is None:
            raise RuntimeError("AI_BUNDLE_NOT_FOUND")
        return loaded

    def _write_languages(self, bundle_id: str, languages: dict[str, Any], *, update: bool = False) -> None:
        from skillmind_server.video_bundle import LANGUAGES

        for lang in LANGUAGES:
            item = languages.get(lang) or {}
            localization = {
                "title": item.get("title"),
                "lecture": item.get("lecture") or {},
                "summary": item.get("summary") or "",
                "glossary": item.get("glossary") or [],
                "manually_edited": update,
            }
            track = {
                "cues": item.get("cues") or [],
                "vtt_text": item.get("vtt_text") or "",
                "srt_text": item.get("srt_text") or "",
                "manually_edited": update,
            }
            if update:
                self.service.table("lesson_localizations").update(localization).eq("bundle_id", bundle_id).eq("language", lang).execute()
                self.service.table("subtitle_tracks").update(track).eq("bundle_id", bundle_id).eq("language", lang).execute()
            else:
                self.service.table("lesson_localizations").insert({"bundle_id": bundle_id, "language": lang, **localization}).execute()
                self.service.table("subtitle_tracks").insert({"bundle_id": bundle_id, "language": lang, **track}).execute()

    def _bundle(self, row: dict[str, Any]) -> dict[str, Any]:
        from skillmind_server.video_bundle import LANGUAGES

        locs = self.service.table("lesson_localizations").select("*").eq("bundle_id", row["id"]).execute().data or []
        tracks = self.service.table("subtitle_tracks").select("*").eq("bundle_id", row["id"]).execute().data or []
        loc_by = {item["language"]: item for item in locs}
        track_by = {item["language"]: item for item in tracks}
        languages: dict[str, Any] = {}
        for lang in LANGUAGES:
            loc = loc_by.get(lang) or {}
            track = track_by.get(lang) or {}
            languages[lang] = {
                "title": loc.get("title") or "",
                "summary": loc.get("summary") or "",
                "lecture": loc.get("lecture") or {},
                "glossary": loc.get("glossary") or [],
                "cues": track.get("cues") or [],
                "vtt_text": track.get("vtt_text") or "",
                "srt_text": track.get("srt_text") or "",
            }
        source = self.get_source(row["source_id"]) if row.get("source_id") else None
        return {
            "id": row["id"],
            "course_id": row["course_id"],
            "lesson_id": row["lesson_id"],
            "source_id": row.get("source_id"),
            "job_id": row.get("job_id"),
            "version_number": row.get("version_number") or 1,
            "content_revision": row.get("content_revision") or 1,
            "lesson_revision": row.get("lesson_revision"),
            "source_revision": row.get("source_revision"),
            "status": row.get("status") or "draft",
            "stale_at": row.get("stale_at"),
            "reviewed_by": row.get("reviewed_by"),
            "youtube_id": source.youtube_id if source else None,
            "duration_seconds": source.duration_seconds if source else None,
            "languages": languages,
        }

    def _source(self, row: dict[str, Any]) -> MediaSourceRecord:
        return MediaSourceRecord(
            id=row["id"],
            course_id=row["course_id"],
            lesson_id=row["lesson_id"],
            created_by=row.get("created_by") or "",
            source_kind=row["source_kind"],
            status=row["status"],
            content_revision=row.get("content_revision") or 1,
            mime_type=row.get("mime_type"),
            byte_size=row.get("byte_size"),
            duration_seconds=row.get("duration_seconds"),
            content_sha256=row.get("content_sha256"),
            error_code=row.get("error_code"),
            youtube_id=row.get("youtube_id"),
        )

    def _upload(self, row: dict[str, Any]) -> MediaUploadRecord:
        expires = row["expires_at"]
        if isinstance(expires, str):
            expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
        return MediaUploadRecord(
            id=row["id"],
            source_id=row["source_id"],
            user_id=row["user_id"],
            bucket_name=row["bucket_name"],
            object_key=row["object_key"],
            multipart_upload_id=row.get("multipart_upload_id"),
            expected_bytes=row["expected_bytes"],
            part_size_bytes=row["part_size_bytes"],
            status=row["status"],
            expires_at=expires,
        )

    def _job(self, row: dict[str, Any]) -> JobRecord:
        return JobRecord(
            id=row["id"],
            requested_by=row["requested_by"],
            task_type=row["task_type"],
            status=row["status"],
            progress=row.get("progress") or 0,
            course_id=row.get("course_id"),
            lesson_id=row.get("lesson_id"),
            source_id=row.get("source_id"),
            error_code=row.get("error_code"),
            idempotency_key=row.get("idempotency_key"),
            output=row.get("output"),
        )
