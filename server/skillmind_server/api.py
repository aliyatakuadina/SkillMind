from __future__ import annotations

from typing import Annotated, Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from supabase import create_client

from skillmind_server.admin_ai import AdminAiService
from skillmind_server.auth import user_from_authorization
from skillmind_server.bundles import BundleService
from skillmind_server.chat import ChatService, IndexService
from skillmind_server.data import DataAccess, MemoryData, LessonRef, SupabaseData
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.jobs import JobService
from skillmind_server.media import MediaService
from skillmind_server.providers import provider_status
from skillmind_server.rewards import RewardsService
from skillmind_server.settings import Settings
from skillmind_server.storage import MemoryStorage, MinioStorage
from skillmind_server.youtube import watch_url


class UploadInitBody(BaseModel):
    course_id: str
    lesson_id: str
    filename: str
    mime_type: str
    expected_bytes: int = Field(gt=0)


class YoutubeBody(BaseModel):
    course_id: str
    lesson_id: str
    url: str
    idempotency_key: str | None = None


class EnqueueBody(BaseModel):
    task_type: str
    idempotency_key: str
    input: dict[str, Any] = Field(default_factory=dict)
    course_id: str | None = None
    lesson_id: str | None = None
    source_id: str | None = None


class ProbeBody(BaseModel):
    profile: str = "lecture"
    prompt: str | None = None


class BundleSaveBody(BaseModel):
    expected_revision: int
    languages: dict[str, Any]


class BundlePublishBody(BaseModel):
    expected_revision: int
    confirmed: bool = False


class ChatAskBody(BaseModel):
    course_id: str
    lesson_id: str | None = None
    message: str
    language: str = "ru"
    idempotency_key: str
    thread_id: str | None = None


class AwardBody(BaseModel):
    event_type: str
    entity_id: str
    course_id: str
    historical: bool = False


class PreferencesBody(BaseModel):
    public_alias: str | None = None
    weekly_goal_days: int | None = None
    next_weekly_goal_days: int | None = None


def create_app(
    settings: Settings | None = None,
    *,
    storage=None,
    data: DataAccess | None = None,
    user: AuthUser | None = None,
    caller=None,
) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="SkillMind API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    if storage is None:
        storage = (
            MinioStorage(
                endpoint=settings.minio_endpoint,
                access_key=settings.minio_access_key,
                secret_key=settings.minio_secret_key,
                bucket=settings.minio_bucket,
                public_endpoint=settings.minio_public_endpoint,
                public_use_ssl=settings.minio_public_use_ssl,
                region=settings.minio_region,
            )
            if settings.media_configured
            else MemoryStorage()
        )
    if data is None and settings.local_mode:
        from skillmind_server.local_pg import LocalData

        data = LocalData(settings)
        _activate_local_ai_config(settings, data)
    elif data is None and settings.supabase_configured:
        service = create_client(settings.supabase_url, settings.supabase_service_role_key)

        def user_factory(token: str):
            client = create_client(settings.supabase_url, settings.supabase_anon_key or settings.supabase_service_role_key)
            client.postgrest.auth(token)
            return client

        data = SupabaseData(service, user_factory)
    if data is None:
        data = MemoryData(
            teacher_id="00000000-0000-4000-8000-000000000001",
            lesson=LessonRef(
                course_id="00000000-0000-4000-8000-000000000010",
                lesson_id="00000000-0000-4000-8000-000000000030",
                course_revision=1,
                lesson_revision=1,
            ),
        )

    media = MediaService(data, storage, settings.minio_bucket)
    jobs = JobService(data)
    bundles = BundleService(data)
    admin_ai = AdminAiService(settings, data, caller=caller)
    indexes = IndexService(data, settings, caller=caller)
    chats = ChatService(data, settings, indexes, caller=caller)
    rewards = RewardsService(data)
    if settings.media_configured:
        try:
            storage.ensure_bucket()
        except Exception as error:
            print(f"minio bucket setup failed: {error}")
    app.state.settings = settings
    app.state.storage = storage
    app.state.data = data
    app.state.media = media
    app.state.jobs = jobs
    app.state.bundles = bundles
    app.state.admin_ai = admin_ai
    app.state.indexes = indexes
    app.state.chats = chats
    app.state.rewards = rewards
    app.state.fixed_user = user

    def current_user(authorization: Annotated[str | None, Header()] = None) -> AuthUser:
        if app.state.fixed_user:
            return app.state.fixed_user
        return user_from_authorization(authorization, settings)

    if settings.local_mode:
        from skillmind_server.local_http import register_local_routes

        register_local_routes(app, settings, current_user)

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse({"error": error.code, "detail": error.detail}, status_code=error.status_code)

    @app.get("/health")
    def health() -> dict:
        return {
            "ok": True,
            "mode": "local" if settings.local_mode else "cloud",
            "media": settings.media_configured,
            "supabase": settings.supabase_configured,
        }

    @app.get("/health/providers")
    def health_providers() -> dict:
        return provider_status(settings)

    @app.post("/v1/media/uploads")
    def init_upload(body: UploadInitBody, actor: AuthUser = Depends(current_user)) -> dict:
        if not settings.media_configured:
            raise ApiError(503, "MEDIA_STORAGE_UNAVAILABLE")
        return media.init_upload(
            actor,
            course_id=body.course_id,
            lesson_id=body.lesson_id,
            filename=body.filename,
            mime_type=body.mime_type,
            expected_bytes=body.expected_bytes,
        )

    @app.get("/v1/media/uploads/{upload_id}")
    def get_upload(upload_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return media.get_upload(actor, upload_id)

    @app.post("/v1/media/uploads/{upload_id}/parts/{part_number}/url")
    def part_url(upload_id: str, part_number: int, actor: AuthUser = Depends(current_user)) -> dict:
        return media.part_url(actor, upload_id, part_number)

    @app.post("/v1/media/uploads/{upload_id}/complete")
    def complete_upload(upload_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return media.complete(actor, upload_id)

    @app.post("/v1/media/uploads/{upload_id}/abort")
    def abort_upload(upload_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return media.abort(actor, upload_id)

    @app.post("/v1/media/youtube")
    def register_youtube(body: YoutubeBody, actor: AuthUser = Depends(current_user)) -> dict:
        source = media.register_youtube(
            actor,
            course_id=body.course_id,
            lesson_id=body.lesson_id,
            url=body.url,
        )
        job = jobs.enqueue(
            actor,
            task_type="video_bundle",
            idempotency_key=body.idempotency_key or str(uuid4()),
            input_payload={
                "source": "youtube",
                "youtube_id": source.youtube_id,
                "url": watch_url(source.youtube_id or ""),
                "duration_seconds": source.duration_seconds,
            },
            course_id=source.course_id,
            lesson_id=source.lesson_id,
            source_id=source.id,
        )
        return {"source": source.__dict__, "job": job}

    @app.post("/v1/jobs")
    def enqueue_job(body: EnqueueBody, actor: AuthUser = Depends(current_user)) -> dict:
        return jobs.enqueue(
            actor,
            task_type=body.task_type,
            idempotency_key=body.idempotency_key,
            input_payload=body.input,
            course_id=body.course_id,
            lesson_id=body.lesson_id,
            source_id=body.source_id,
        )

    @app.get("/v1/jobs/{job_id}")
    def get_job(job_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return jobs.get(actor, job_id)

    @app.post("/v1/jobs/{job_id}/cancel")
    def cancel_job(job_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return jobs.cancel(actor, job_id)

    @app.post("/v1/jobs/{job_id}/bundle")
    def persist_job_bundle(job_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return bundles.persist_from_job(actor, job_id)

    @app.get("/v1/lessons/{lesson_id}/ai-bundle")
    def get_lesson_bundle(lesson_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return bundles.get_for_lesson(actor, lesson_id)

    @app.get("/v1/ai-bundles/{bundle_id}")
    def get_bundle(bundle_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return bundles.get(actor, bundle_id)

    @app.patch("/v1/ai-bundles/{bundle_id}")
    def save_bundle(bundle_id: str, body: BundleSaveBody, actor: AuthUser = Depends(current_user)) -> dict:
        return bundles.save_draft(actor, bundle_id, expected_revision=body.expected_revision, languages=body.languages)

    @app.post("/v1/ai-bundles/{bundle_id}/publish")
    def publish_bundle(bundle_id: str, body: BundlePublishBody, actor: AuthUser = Depends(current_user)) -> dict:
        if not body.confirmed:
            raise ApiError(400, "AI_AUTHOR_REVIEW_REQUIRED")
        published = bundles.publish(actor, bundle_id, expected_revision=body.expected_revision)
        try:
            indexes.rebuild_for_bundle(actor, bundle_id)
        except ApiError:
            pass
        return published

    @app.post("/v1/ai-bundles/{bundle_id}/index")
    def rebuild_index(bundle_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return indexes.rebuild_for_bundle(actor, bundle_id)

    @app.post("/v1/chat/ask")
    def chat_ask(body: ChatAskBody, actor: AuthUser = Depends(current_user)) -> dict:
        return chats.ask(
            actor,
            course_id=body.course_id,
            lesson_id=body.lesson_id,
            message=body.message,
            language=body.language,
            idempotency_key=body.idempotency_key,
            thread_id=body.thread_id,
        )

    @app.get("/v1/chat/threads/{thread_id}")
    def chat_thread(thread_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return chats.list_thread(actor, thread_id)

    @app.post("/v1/rewards/award")
    def award_xp(body: AwardBody, actor: AuthUser = Depends(current_user)) -> dict:
        return rewards.award(
            actor,
            event_type=body.event_type,
            entity_id=body.entity_id,
            course_id=body.course_id,
            historical=body.historical,
        )

    @app.get("/v1/rewards/me")
    def rewards_me(actor: AuthUser = Depends(current_user)) -> dict:
        return rewards.summary(actor)

    @app.patch("/v1/rewards/preferences")
    def rewards_preferences(body: PreferencesBody, actor: AuthUser = Depends(current_user)) -> dict:
        return rewards.set_preferences(
            actor,
            public_alias=body.public_alias,
            weekly_goal_days=body.weekly_goal_days,
            next_weekly_goal_days=body.next_weekly_goal_days,
        )

    @app.post("/v1/rewards/courses/{course_id}/ranking/join")
    def join_ranking(course_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return rewards.join_ranking(actor, course_id)

    @app.post("/v1/rewards/courses/{course_id}/ranking/leave")
    def leave_ranking(course_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return rewards.leave_ranking(actor, course_id)

    @app.get("/v1/rewards/courses/{course_id}/leaderboard")
    def leaderboard(course_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return rewards.leaderboard(actor, course_id)

    @app.get("/v1/admin/ai")
    def admin_ai_overview(actor: AuthUser = Depends(current_user)) -> dict:
        return admin_ai.overview(actor)

    @app.post("/v1/admin/ai/config/activate-file")
    def admin_activate_file(actor: AuthUser = Depends(current_user)) -> dict:
        return admin_ai.activate_file(actor)

    @app.post("/v1/admin/ai/catalog/refresh")
    def admin_refresh_catalog(actor: AuthUser = Depends(current_user)) -> dict:
        return admin_ai.refresh_catalog(actor)

    @app.post("/v1/admin/ai/probe")
    def admin_probe(body: ProbeBody, actor: AuthUser = Depends(current_user)) -> dict:
        return admin_ai.probe(actor, body.profile, body.prompt)

    @app.post("/v1/admin/ai/jobs/{job_id}/cancel")
    def admin_cancel_job(job_id: str, actor: AuthUser = Depends(current_user)) -> dict:
        return admin_ai.cancel_job(actor, job_id)

    return app


def _activate_local_ai_config(settings: Settings, data) -> None:
    from skillmind_server.config_file import bind_litellm_url, load_ai_config

    config = bind_litellm_url(load_ai_config(settings.config_path), settings.litellm_base_url)
    try:
        versions = data.list_config_versions()
        match = next((item for item in versions if item.get("file_sha256") == config.file_sha256), None)
        if match is None:
            match = data.insert_config_version(
                config=config.raw,
                file_sha256=config.file_sha256,
                description="LiteLLM qwen-chat, qwen-embed, whisper-1",
                created_by=None,
            )
        data.set_active_config(match["id"])
    except Exception as error:
        print(f"local ai config activate skipped: {error}")


app = create_app()
