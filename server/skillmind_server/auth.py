from __future__ import annotations

import jwt
from jwt import PyJWKClient

from skillmind_server.errors import ApiError, AuthUser
from skillmind_server.settings import Settings


def decode_access_token(token: str, settings: Settings) -> dict:
    if settings.local_mode and settings.local_jwt_secret:
        try:
            return jwt.decode(token, settings.local_jwt_secret, algorithms=["HS256"], options={"verify_aud": False})
        except Exception as error:
            raise ApiError(401, "AI_AUTH_REQUIRED") from error
    audiences = ["authenticated", "anon"]
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        signing_key = PyJWKClient(jwks_url, cache_keys=True).get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256", "HS256"],
            audience=audiences,
            options={"verify_aud": False},
        )
    except Exception:
        if not settings.supabase_jwt_secret:
            raise ApiError(401, "AI_AUTH_REQUIRED") from None
        try:
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        except Exception as error:
            raise ApiError(401, "AI_AUTH_REQUIRED") from error


def user_from_authorization(header: str | None, settings: Settings) -> AuthUser:
    if not header or not header.lower().startswith("bearer "):
        raise ApiError(401, "AI_AUTH_REQUIRED")
    token = header.split(" ", 1)[1].strip()
    if not token:
        raise ApiError(401, "AI_AUTH_REQUIRED")
    payload = decode_access_token(token, settings)
    user_id = payload.get("sub")
    if not user_id:
        raise ApiError(401, "AI_AUTH_REQUIRED")
    return AuthUser(id=str(user_id), token=token)
