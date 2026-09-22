from __future__ import annotations

import hashlib
import hmac
import os
from typing import Annotated, Any
from uuid import uuid4

import boto3
import jwt
import psycopg2
from botocore.client import Config
from fastapi import Depends, FastAPI, File, Form, Header, UploadFile
from psycopg2.extras import Json

from skillmind_server.auth import user_from_authorization
from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.local_pg import connect, run_browser_query, run_browser_rpc
from skillmind_server.settings import Settings

STORAGE_BUCKETS = ("course-assets", "submission-files", "certificates")


def register_local_routes(app: FastAPI, settings: Settings, current_user) -> None:
    @app.post("/v1/auth/register")
    def register(body: dict[str, Any]) -> dict:
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        name = str(body.get("full_name") or "").strip()
        role = body.get("role") if body.get("role") in {"student", "teacher"} else "student"
        if "@" not in email or len(password) < 6:
            raise ApiError(400, "AI_INVALID_INPUT")
        user_id = str(uuid4())
        try:
            with connect(settings) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
                        values (%s, %s, %s, %s)
                        """,
                        (user_id, email, hash_password(password), Json({"full_name": name, "role": role})),
                    )
                connection.commit()
        except psycopg2.errors.UniqueViolation as error:
            raise ApiError(409, "AI_EMAIL_TAKEN", "Этот адрес уже зарегистрирован. Войдите.") from error
        return {"data": {"session": session_for(settings, user_id, email)}, "error": None}

    @app.post("/v1/auth/login")
    def login(body: dict[str, Any]) -> dict:
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        with connect(settings) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "select id::text, encrypted_password from auth.users where email = %s",
                    (email,),
                )
                row = cursor.fetchone()
        if not row or not verify_password(password, row[1]):
            raise ApiError(401, "AI_AUTH_REQUIRED", "Неверный адрес или пароль.")
        return {"data": {"session": session_for(settings, row[0], email)}, "error": None}

    @app.post("/v1/data/query")
    def data_query(body: dict[str, Any], authorization: Annotated[str | None, Header()] = None) -> dict:
        user = _bearer(authorization, settings)
        try:
            data = run_browser_query(settings, user.id if user else None, body)
        except ApiError:
            raise
        return {"data": data, "error": None}

    @app.post("/v1/data/rpc")
    def data_rpc(body: dict[str, Any], authorization: Annotated[str | None, Header()] = None) -> dict:
        user = _bearer(authorization, settings)
        data = run_browser_rpc(
            settings,
            user.id if user else None,
            str(body.get("fn") or ""),
            body.get("args") or {},
            body.get("mode"),
        )
        return {"data": data, "error": None}

    @app.post("/v1/storage/upload")
    async def storage_upload(
        bucket: str = Form(...),
        path: str = Form(...),
        file: UploadFile = File(...),
        actor: AuthUser = Depends(current_user),
    ) -> dict:
        _bucket(bucket)
        _path(path)
        payload = await file.read()
        _storage_row(settings, actor, bucket, path, len(payload))
        _s3(settings, bucket).put_object(Bucket=bucket, Key=path, Body=payload, ContentType=file.content_type or "application/octet-stream")
        return {"data": {"path": path}, "error": None}

    @app.post("/v1/storage/remove")
    def storage_remove(body: dict[str, Any], actor: AuthUser = Depends(current_user)) -> dict:
        bucket = _bucket(str(body.get("bucket") or ""))
        paths = [str(item) for item in body.get("paths") or []]
        for path in paths:
            _path(path)
            _delete_row(settings, actor, bucket, path)
            _s3(settings, bucket).delete_object(Bucket=bucket, Key=path)
        return {"data": paths, "error": None}

    @app.post("/v1/storage/list")
    def storage_list(body: dict[str, Any], actor: AuthUser = Depends(current_user)) -> dict:
        bucket = _bucket(str(body.get("bucket") or ""))
        prefix = str(body.get("prefix") or "").strip("/")
        with connect(settings) as connection:
            with connection.cursor() as cursor:
                _as_user(cursor, actor.id)
                like = f"{prefix}/%" if prefix else "%"
                cursor.execute(
                    """
                    select name from storage.objects
                    where bucket_id = %s and name like %s
                    """,
                    (bucket, like),
                )
                names = [row[0] for row in cursor.fetchall()]
            connection.commit()
        folder = []
        lead = f"{prefix}/" if prefix else ""
        for name in names:
            rest = name[len(lead):] if name.startswith(lead) else name
            if rest and "/" not in rest:
                folder.append({"name": rest})
        return {"data": folder, "error": None}

    @app.post("/v1/storage/sign")
    def storage_sign(body: dict[str, Any], actor: AuthUser = Depends(current_user)) -> dict:
        bucket = _bucket(str(body.get("bucket") or ""))
        path = _path(str(body.get("path") or ""))
        expires = int(body.get("expires") or 3600)
        with connect(settings) as connection:
            with connection.cursor() as cursor:
                _as_user(cursor, actor.id)
                cursor.execute(
                    "select id::text from storage.objects where bucket_id = %s and name = %s",
                    (bucket, path),
                )
                if cursor.fetchone() is None:
                    raise ApiError(403, "AI_ACCESS_DENIED")
            connection.commit()
        url = _public_s3(settings).generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": path},
            ExpiresIn=max(60, min(expires, 86400)),
        )
        return {"data": {"signedUrl": url}, "error": None}

    if settings.media_configured:
        try:
            client = _s3(settings, STORAGE_BUCKETS[0])
            existing = {item["Name"] for item in client.list_buckets().get("Buckets", [])}
            for name in STORAGE_BUCKETS:
                if name not in existing:
                    client.create_bucket(Bucket=name)
        except Exception as error:
            print(f"local storage buckets skipped: {error}")


def session_for(settings: Settings, user_id: str, email: str) -> dict[str, Any]:
    token = jwt.encode(
        {"sub": user_id, "email": email, "role": "authenticated"},
        settings.local_jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "user": {"id": user_id, "email": email}}


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
    return hmac.compare_digest(digest.hex(), digest_hex)


def _bearer(authorization: str | None, settings: Settings) -> AuthUser | None:
    if not authorization:
        return None
    return user_from_authorization(authorization, settings)


def _bucket(name: str) -> str:
    if name not in STORAGE_BUCKETS:
        raise ApiError(400, "AI_INVALID_INPUT")
    return name


def _path(path: str) -> str:
    if not path or path.startswith("/") or ".." in path.split("/"):
        raise ApiError(400, "AI_INVALID_INPUT")
    return path


def _as_user(cursor, user_id: str) -> None:
    cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (user_id,))
    cursor.execute("select set_config('request.jwt.claim.role', 'authenticated', true)")
    cursor.execute("set local role authenticated")


def _storage_row(settings: Settings, actor: AuthUser, bucket: str, path: str, size: int) -> None:
    with connect(settings) as connection:
        with connection.cursor() as cursor:
            _as_user(cursor, actor.id)
            cursor.execute(
                """
                insert into storage.objects (bucket_id, name, owner)
                values (%s, %s, %s)
                on conflict (bucket_id, name) do update set updated_at = now(), owner = excluded.owner
                """,
                (bucket, path, actor.id),
            )
        connection.commit()


def _delete_row(settings: Settings, actor: AuthUser, bucket: str, path: str) -> None:
    with connect(settings) as connection:
        with connection.cursor() as cursor:
            _as_user(cursor, actor.id)
            cursor.execute("delete from storage.objects where bucket_id = %s and name = %s", (bucket, path))
        connection.commit()


def _s3(settings: Settings, bucket: str):
    del bucket
    return _s3_client(settings.minio_endpoint, settings, use_ssl=False)


def _public_s3(settings: Settings):
    return _s3_client(settings.minio_public_endpoint, settings, use_ssl=settings.minio_public_use_ssl)


def _s3_client(endpoint: str, settings: Settings, *, use_ssl: bool):
    if not endpoint.startswith("http"):
        endpoint = f"{'https' if use_ssl else 'http'}://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name=settings.minio_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
