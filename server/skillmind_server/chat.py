from __future__ import annotations

import json
from typing import Any, Callable
from uuid import uuid4

from skillmind_server.adapters import Candidate, HttpCaller, ProviderError, complete_gemini
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.indexing import EMBED_DIM, EMBED_MODEL, bundle_chunks, chunk_text, cosine, embed_texts
from skillmind_server.router import run_text
from skillmind_server.settings import Settings


def _lecture_rows(checkpoint: dict[str, Any], course_id: str, lesson_id: str, lesson_revision: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    lecture = checkpoint.get("lecture") if isinstance(checkpoint.get("lecture"), dict) else {}
    overview = " ".join(
        part
        for part in (
            str(checkpoint.get("title") or ""),
            str(checkpoint.get("summary") or ""),
            " ".join(str(item) for item in (lecture.get("goals") or []) if item),
        )
        if part.strip()
    )
    for index, piece in enumerate(chunk_text(overview)):
        rows.append(_chunk_row(course_id, lesson_id, lesson_revision, "overview", index, piece, None, None))
    for index, section in enumerate(lecture.get("sections") or []):
        if not isinstance(section, dict):
            continue
        text = " ".join(str(section.get(key) or "") for key in ("heading", "body")).strip()
        for part_index, piece in enumerate(chunk_text(text)):
            rows.append(
                _chunk_row(
                    course_id,
                    lesson_id,
                    lesson_revision,
                    f"section-{index}",
                    part_index,
                    piece,
                    section.get("start_seconds"),
                    None,
                )
            )
    cue_bits: list[str] = []
    cue_start = None
    cue_end = None
    cue_index = 0
    for cue in checkpoint.get("cues") or []:
        if not isinstance(cue, dict):
            continue
        cue_bits.append(str(cue.get("text") or ""))
        cue_start = cue_start if cue_start is not None else cue.get("start")
        cue_end = cue.get("end")
        if sum(len(bit) for bit in cue_bits) >= 700:
            rows.append(_chunk_row(course_id, lesson_id, lesson_revision, "cues", cue_index, " ".join(cue_bits), cue_start, cue_end))
            cue_bits = []
            cue_start = None
            cue_index += 1
    if cue_bits:
        rows.append(_chunk_row(course_id, lesson_id, lesson_revision, "cues", cue_index, " ".join(cue_bits), cue_start, cue_end))
    return rows


def _chunk_row(course_id, lesson_id, lesson_revision, kind, index, content, start, end) -> dict[str, Any]:
    return {
        "course_id": course_id,
        "lesson_id": lesson_id,
        "bundle_id": None,
        "lesson_revision": lesson_revision,
        "language": "ru",
        "source_kind": "lesson_text",
        "chunk_key": f"lesson:{kind}:{index}",
        "content": content,
        "start_seconds": start,
        "end_seconds": end,
    }


def _clock(value: Any) -> str:
    try:
        total = int(float(value))
    except (TypeError, ValueError):
        return ""
    if total < 0:
        return ""
    return f"{total // 60}:{total % 60:02d}"


def _as_vector(value: Any) -> list[float]:
    if isinstance(value, list):
        return [float(item) for item in value]
    if isinstance(value, str) and value.startswith("["):
        return [float(item) for item in value.strip("[]").split(",") if item.strip()]
    return []


class IndexService:
    def __init__(self, data, settings: Settings, caller: Callable | None = None) -> None:
        self.data = data
        self.settings = settings
        self.caller = caller

    def rebuild_for_bundle(self, user: AuthUser, bundle_id: str) -> dict[str, Any]:
        bundle = self.data.get_ai_bundle(bundle_id)
        if bundle is None or bundle.get("status") != "published":
            raise ApiError(404, "AI_BUNDLE_NOT_FOUND")
        if not self.data.is_admin(user.token) and not self.data.is_course_author(user.token, bundle["course_id"]):
            raise ApiError(403, "AI_ACCESS_DENIED")
        rows = bundle_chunks(bundle)
        if not rows:
            raise ApiError(400, "AI_INVALID_INPUT")
        from skillmind_server.config_file import bind_litellm_url, load_ai_config

        config = bind_litellm_url(load_ai_config(self.settings.config_path), self.settings.litellm_base_url)
        vectors = embed_texts(
            config,
            self.settings.secret_map(),
            [row["content"] for row in rows],
            caller=self.caller,
        )
        version = self.data.create_index_version(
            {
                "id": str(uuid4()),
                "course_id": bundle["course_id"],
                "provider": "gemini",
                "model_id": EMBED_MODEL,
                "dimensions": EMBED_DIM,
                "status": "building",
            }
        )
        chunks = []
        for row, vector in zip(rows, vectors):
            chunks.append(
                {
                    "id": str(uuid4()),
                    "index_version_id": version["id"],
                    "course_id": bundle["course_id"],
                    "lesson_id": bundle["lesson_id"],
                    "bundle_id": bundle_id,
                    "lesson_revision": bundle.get("lesson_revision"),
                    "language": row["language"],
                    "source_kind": row["source_kind"],
                    "chunk_key": row["chunk_key"],
                    "content": row["content"],
                    "start_seconds": row.get("start_seconds"),
                    "end_seconds": row.get("end_seconds"),
                    "embedding": vector,
                }
            )
        self.data.replace_course_chunks(version["id"], chunks)
        active = self.data.activate_index_version(version["id"], bundle["course_id"])
        return {"index_version_id": active["id"], "chunks": len(chunks), "dimensions": EMBED_DIM}

    def ensure_course_material(self, course_id: str) -> None:
        version = self.data.active_index_version(course_id)
        if version and self.data.list_course_chunks(version["id"]):
            return
        rows = self._material_rows(course_id)
        if not rows:
            return
        from skillmind_server.config_file import bind_litellm_url, load_ai_config

        config = bind_litellm_url(load_ai_config(self.settings.config_path), self.settings.litellm_base_url)
        vectors = embed_texts(config, self.settings.secret_map(), [row["content"] for row in rows], caller=self.caller)
        created = self.data.create_index_version(
            {
                "id": str(uuid4()),
                "course_id": course_id,
                "provider": "litellm",
                "model_id": EMBED_MODEL,
                "dimensions": EMBED_DIM,
                "status": "building",
            }
        )
        chunks = []
        for row, vector in zip(rows, vectors):
            chunks.append({**row, "id": str(uuid4()), "index_version_id": created["id"], "embedding": vector})
        self.data.replace_course_chunks(created["id"], chunks)
        self.data.activate_index_version(created["id"], course_id)

    def _lesson_titles(self, lesson_ids: list[str]) -> dict[str, str]:
        unique = list(dict.fromkeys(lesson_ids))
        if not unique:
            return {}
        from skillmind_server.local_pg import connect

        with connect(self.settings) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id::text, title from public.lessons where id = any(%s::uuid[])", (unique,))
                return {row[0]: row[1] for row in cursor.fetchall()}

    def _material_rows(self, course_id: str) -> list[dict[str, Any]]:
        from skillmind_server.local_pg import connect

        rows: list[dict[str, Any]] = []
        with connect(self.settings) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select s.checkpoint, j.lesson_id::text, j.lesson_revision
                    from public.ai_job_steps s
                    join public.ai_jobs j on j.id = s.job_id
                    where j.course_id = %s and s.step_key = 'lecture:ru' and s.status = 'completed'
                    """,
                    (course_id,),
                )
                lectures = cursor.fetchall()
                cursor.execute(
                    """
                    select l.id::text, l.content_revision, li.payload
                    from public.lessons l
                    join public.modules m on m.id = l.module_id
                    left join public.lesson_items li on li.lesson_id = l.id
                    where m.course_id = %s
                    """,
                    (course_id,),
                )
                lessons = cursor.fetchall()
        self._ensure_text_items({lesson_id for _checkpoint, lesson_id, _revision in lectures})
        for checkpoint, lesson_id, lesson_revision in lectures:
            if isinstance(checkpoint, str):
                checkpoint = json.loads(checkpoint)
            if not isinstance(checkpoint, dict):
                continue
            rows.extend(_lecture_rows(checkpoint, course_id, lesson_id, lesson_revision or 1))
        for lesson_id, lesson_revision, payload in lessons:
            if isinstance(payload, str):
                payload = json.loads(payload)
            text = " ".join(
                str((payload or {}).get(key) or "")
                for key in ("content", "title")
            ).strip()
            for index, piece in enumerate(chunk_text(text)):
                rows.append(_chunk_row(course_id, lesson_id, lesson_revision or 1, "lesson", index, piece, None, None))
        return rows

    def _ensure_text_items(self, lesson_ids: set[str]) -> None:
        if not lesson_ids:
            return
        from skillmind_server.local_pg import connect

        with connect(self.settings) as connection:
            with connection.cursor() as cursor:
                for lesson_id in lesson_ids:
                    cursor.execute(
                        "select 1 from public.lesson_items where lesson_id = %s and type = 'rich_text'",
                        (lesson_id,),
                    )
                    if cursor.fetchone():
                        continue
                    cursor.execute(
                        "select coalesce(max(order_index), -1) + 1 from public.lesson_items where lesson_id = %s",
                        (lesson_id,),
                    )
                    order_index = cursor.fetchone()[0]
                    cursor.execute(
                        """
                        insert into public.lesson_items (lesson_id, type, payload, order_index)
                        values (%s, 'rich_text', %s::jsonb, %s)
                        """,
                        (lesson_id, '{"content":"Текст лекции по расшифровке видео."}', order_index),
                    )
            connection.commit()

    def search(self, user: AuthUser, course_id: str, query: str, *, language: str = "ru", limit: int = 5) -> list[dict[str, Any]]:
        if not self.data.can_use_course_chat(user.token, course_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        try:
            self.ensure_course_material(course_id)
        except Exception:
            pass
        version = self.data.active_index_version(course_id)
        if version is None:
            return []
        from skillmind_server.config_file import bind_litellm_url, load_ai_config

        config = bind_litellm_url(load_ai_config(self.settings.config_path), self.settings.litellm_base_url)
        vectors = embed_texts(config, self.settings.secret_map(), [query], caller=self.caller)
        query_vec = vectors[0]
        scored = []
        for chunk in self.data.list_course_chunks(version["id"], language=language):
            score = cosine(query_vec, _as_vector(chunk.get("embedding")))
            if score < 0:
                continue
            scored.append({**chunk, "score": score})
        scored.sort(key=lambda item: item["score"], reverse=True)
        picked = []
        seen: set[tuple[str, int | None]] = set()
        for item in scored:
            start = item.get("start_seconds")
            mark = None if start is None else int(float(start))
            key = (str(item.get("lesson_id") or ""), mark)
            if key in seen:
                continue
            seen.add(key)
            picked.append(item)
            if len(picked) >= limit:
                break
        titles = self._lesson_titles([str(item.get("lesson_id")) for item in picked if item.get("lesson_id")])
        return [
            {
                "lesson_id": item.get("lesson_id"),
                "lesson_title": titles.get(str(item.get("lesson_id") or "")),
                "bundle_id": item.get("bundle_id"),
                "language": item.get("language"),
                "source_kind": item.get("source_kind"),
                "content": item.get("content"),
                "start_seconds": item.get("start_seconds"),
                "end_seconds": item.get("end_seconds"),
                "score": round(float(item["score"]), 4),
            }
            for item in picked
        ]


class ChatService:
    def __init__(self, data, settings: Settings, index: IndexService, caller: Callable | None = None) -> None:
        self.data = data
        self.settings = settings
        self.index = index
        self.caller = caller

    def ask(
        self,
        user: AuthUser,
        *,
        course_id: str,
        lesson_id: str | None,
        message: str,
        language: str = "ru",
        idempotency_key: str,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        runtime = self.data.get_runtime()
        if not runtime.get("chat_enabled"):
            raise ApiError(403, "AI_FEATURE_DISABLED")
        if not self.data.can_use_course_chat(user.token, course_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        text = (message or "").strip()
        if len(text) < 1 or len(text) > 4000:
            raise ApiError(400, "AI_INVALID_INPUT")
        if language not in {"ru", "kk", "en"}:
            raise ApiError(400, "AI_INVALID_INPUT")
        thread = None
        if thread_id:
            thread = self.data.get_chat_thread(thread_id)
            if thread is None or thread.get("user_id") != user.id or thread.get("course_id") != course_id:
                raise ApiError(404, "AI_CHAT_NOT_FOUND")
        else:
            thread = self.data.create_chat_thread(
                {
                    "id": str(uuid4()),
                    "user_id": user.id,
                    "course_id": course_id,
                    "lesson_id": lesson_id,
                    "language": language,
                    "title": text[:80],
                }
            )
        existing = self.data.find_chat_message(thread["id"], idempotency_key, "assistant")
        if existing:
            return {"thread_id": thread["id"], "message": existing}
        self.data.create_chat_message(
            {
                "id": str(uuid4()),
                "thread_id": thread["id"],
                "role": "user",
                "content": text,
                "citations": [],
                "status": "completed",
                "idempotency_key": idempotency_key,
            }
        )
        citations = self.index.search(user, course_id, text, language=language, limit=3)
        answer = self._answer(text, language, citations)
        if not self.data.can_use_course_chat(user.token, course_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        message_row = self.data.create_chat_message(
            {
                "id": str(uuid4()),
                "thread_id": thread["id"],
                "role": "assistant",
                "content": answer,
                "citations": citations,
                "status": "completed",
                "idempotency_key": idempotency_key,
            }
        )
        return {"thread_id": thread["id"], "message": message_row}

    def list_thread(self, user: AuthUser, thread_id: str) -> dict[str, Any]:
        thread = self.data.get_chat_thread(thread_id)
        if thread is None or thread.get("user_id") != user.id:
            raise ApiError(404, "AI_CHAT_NOT_FOUND")
        if not self.data.can_use_course_chat(user.token, thread["course_id"]):
            raise ApiError(403, "AI_ACCESS_DENIED")
        return {"thread": thread, "messages": self.data.list_chat_messages(thread_id)}

    def _answer(self, question: str, language: str, citations: list[dict[str, Any]]) -> str:
        from skillmind_server.config_file import bind_litellm_url, load_ai_config

        config = bind_litellm_url(load_ai_config(self.settings.config_path), self.settings.litellm_base_url)
        sources = "\n".join(
            f"- [{_clock(item.get('start_seconds'))}] {item.get('content')}" for item in citations
        ) or "(no sources)"
        prompt = (
            f"Answer in language={language}. Write 2-4 short sentences about the main point. "
            "Do not mention identifiers, lesson ids, or raw second counts. "
            "Do not repeat timestamps; the interface lists sources separately. "
            "Use only these sources. If they are insufficient, say so in one sentence. "
            "Do not reveal quiz answers or certificates.\n"
            f"SOURCES:\n{sources}\nQUESTION:\n{question}"
        )

        def complete(candidate: Candidate, text: str) -> str:
            if self.caller:
                return self.caller(candidate, text)
            if candidate.provider == "gemini":
                return complete_gemini(candidate.base_url, candidate.api_key, candidate.model_id, text)
            return HttpCaller().complete(candidate, text)

        result = run_text(config, self.settings.secret_map(), "chat", prompt, complete)
        if result.outcome != "succeeded" or not result.text:
            if not citations:
                return "Недостаточно опубликованных материалов для ответа."
            raise ApiError(503, "AI_PROVIDER_UNAVAILABLE")
        return result.text.strip()
