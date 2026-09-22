from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from skillmind_server.data import DataAccess, MediaSourceRecord, MediaUploadRecord
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.youtube import parse_youtube_id, probe_youtube_public
from skillmind_server.storage import (
    ALLOWED_MIME_TYPES,
    DEFAULT_PART_BYTES,
    MAX_UPLOAD_BYTES,
    MIN_PART_BYTES,
    MediaStorage,
    MemoryStorage,
)


def object_key_for(course_id: str, source_id: str, filename: str) -> str:
    safe_name = "".join(char if char.isalnum() or char in "._-" else "-" for char in filename)[:80]
    return f"courses/{course_id}/sources/{source_id}/{safe_name or 'video'}"


class MediaService:
    def __init__(self, data: DataAccess, storage: MediaStorage, bucket: str, youtube_probe=None) -> None:
        self.data = data
        self.storage = storage
        self.bucket = bucket
        self.youtube_probe = youtube_probe or probe_youtube_public

    def init_upload(
        self,
        user: AuthUser,
        *,
        course_id: str,
        lesson_id: str,
        filename: str,
        mime_type: str,
        expected_bytes: int,
        part_size_bytes: int = DEFAULT_PART_BYTES,
    ) -> dict:
        if mime_type not in ALLOWED_MIME_TYPES:
            raise ApiError(400, "MEDIA_TYPE_UNSUPPORTED")
        if expected_bytes < 1 or expected_bytes > MAX_UPLOAD_BYTES:
            raise ApiError(400, "MEDIA_SIZE_UNSUPPORTED")
        if part_size_bytes < MIN_PART_BYTES:
            raise ApiError(400, "MEDIA_PART_SIZE_UNSUPPORTED")
        if not self.data.can_manage_lesson_write(user.token, lesson_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        lesson = self.data.lesson_ref(lesson_id)
        if lesson is None or lesson.course_id != course_id:
            raise ApiError(400, "AI_INVALID_SCOPE")

        source_id = str(uuid4())
        upload_id = str(uuid4())
        key = object_key_for(course_id, source_id, filename)
        multipart_id = self.storage.create_multipart(key)
        source = self.data.create_source(
            MediaSourceRecord(
                id=source_id,
                course_id=course_id,
                lesson_id=lesson_id,
                created_by=user.id,
                source_kind="upload",
                status="uploading",
                content_revision=1,
                mime_type=mime_type,
                byte_size=expected_bytes,
            )
        )
        upload = self.data.create_upload(
            MediaUploadRecord(
                id=upload_id,
                source_id=source.id,
                user_id=user.id,
                bucket_name=self.bucket,
                object_key=key,
                multipart_upload_id=multipart_id,
                expected_bytes=expected_bytes,
                part_size_bytes=part_size_bytes,
                status="uploading",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
            )
        )
        return self._upload_payload(user, upload, source)

    def get_upload(self, user: AuthUser, upload_id: str) -> dict:
        upload, source = self._owned_upload(user, upload_id)
        return self._upload_payload(user, upload, source)

    def part_url(self, user: AuthUser, upload_id: str, part_number: int) -> dict:
        upload, _source = self._owned_upload(user, upload_id)
        self._ensure_active(upload)
        if part_number < 1:
            raise ApiError(400, "MEDIA_PART_INVALID")
        url = self.storage.presign_part(upload.object_key, upload.multipart_upload_id or "", part_number)
        return {"url": url, "part_number": part_number, "method": "PUT"}

    def complete(self, user: AuthUser, upload_id: str) -> dict:
        upload, source = self._owned_upload(user, upload_id)
        self._ensure_active(upload)
        parts = self.storage.list_parts(upload.object_key, upload.multipart_upload_id or "")
        if not parts:
            raise ApiError(400, "MEDIA_PARTS_MISSING")
        self.storage.complete(upload.object_key, upload.multipart_upload_id or "", parts)
        self.data.update_upload(
            upload.id,
            status="completed",
            completed_at=datetime.now(timezone.utc),
        )
        probe = probe_object(self.storage, upload.object_key)
        fields = {"status": "validating", "byte_size": upload.expected_bytes}
        if probe:
            fields.update(
                status="ready",
                duration_seconds=probe["duration_seconds"],
                content_sha256=probe["sha256"],
                mime_type=probe.get("mime_type") or source.mime_type,
            )
        source = self.data.update_source(source.id, **fields)
        return {"upload": self.data.get_upload(upload.id).__dict__, "source": source.__dict__}

    def abort(self, user: AuthUser, upload_id: str) -> dict:
        upload, source = self._owned_upload(user, upload_id)
        if upload.multipart_upload_id:
            self.storage.abort(upload.object_key, upload.multipart_upload_id)
        self.data.update_upload(upload.id, status="aborted")
        source = self.data.update_source(source.id, status="failed", error_code="MEDIA_ABORTED")
        return {"source_id": source.id, "status": source.status}

    def register_youtube(self, user: AuthUser, *, course_id: str, lesson_id: str, url: str) -> MediaSourceRecord:
        if not self.data.can_manage_lesson_write(user.token, lesson_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        lesson = self.data.lesson_ref(lesson_id)
        if lesson is None or lesson.course_id != course_id:
            raise ApiError(400, "AI_INVALID_SCOPE")
        video_id = parse_youtube_id(url)
        probe = self.youtube_probe(video_id)
        duration = float(probe.get("duration_seconds") or 0)
        if duration <= 0 or duration > 7200:
            raise ApiError(400, "MEDIA_DURATION_UNSUPPORTED")
        return self.data.create_source(
            MediaSourceRecord(
                id=str(uuid4()),
                course_id=course_id,
                lesson_id=lesson_id,
                created_by=user.id,
                source_kind="youtube",
                status="ready",
                content_revision=1,
                duration_seconds=duration,
                youtube_id=video_id,
            )
        )

    def _owned_upload(self, user: AuthUser, upload_id: str):
        upload = self.data.get_upload(upload_id)
        if upload is None or upload.user_id != user.id:
            raise ApiError(404, "MEDIA_UPLOAD_NOT_FOUND")
        source = self.data.get_source(upload.source_id)
        if source is None:
            raise ApiError(404, "MEDIA_SOURCE_NOT_FOUND")
        if not self.data.can_manage_lesson_write(user.token, source.lesson_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        return upload, source

    def _ensure_active(self, upload: MediaUploadRecord) -> None:
        expires = upload.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if upload.status not in {"pending", "uploading", "completing"} or expires <= datetime.now(timezone.utc):
            raise ApiError(409, "MEDIA_UPLOAD_EXPIRED")

    def _upload_payload(self, user: AuthUser, upload: MediaUploadRecord, source: MediaSourceRecord) -> dict:
        parts = []
        if upload.multipart_upload_id and upload.status in {"pending", "uploading", "completing"}:
            parts = self.storage.list_parts(upload.object_key, upload.multipart_upload_id)
        return {
            "upload_id": upload.id,
            "source_id": source.id,
            "status": upload.status,
            "source_status": source.status,
            "bucket_name": upload.bucket_name,
            "object_key": upload.object_key,
            "expected_bytes": upload.expected_bytes,
            "part_size_bytes": upload.part_size_bytes,
            "expires_at": upload.expires_at.isoformat(),
            "parts": parts,
        }


def hash_object(storage: MediaStorage, object_key: str) -> str:
    digest = hashlib.sha256()
    body = storage.open_object(object_key)
    while True:
        chunk = body.read(8 * 1024 * 1024) if hasattr(body, "read") else None
        if not chunk:
            break
        digest.update(chunk)
    return digest.hexdigest()


def probe_object(storage: MediaStorage, object_key: str) -> dict | None:
    if isinstance(storage, MemoryStorage):
        payload = storage.objects.get(object_key, b"")
        return {
            "duration_seconds": 1,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "mime_type": None,
        }
    try:
        hashed = hash_object(storage, object_key)
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", object_key],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        # ffprobe needs a local path; skip duration when the object is remote-only.
        if result.returncode != 0:
            return None
        parsed = json.loads(result.stdout or "{}")
        duration = float((parsed.get("format") or {}).get("duration") or 0)
        if duration <= 0 or duration > 7200:
            return None
        return {"duration_seconds": duration, "sha256": hashed, "mime_type": None}
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None
