import logging

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from app.core.config import settings

logger = logging.getLogger(__name__)


def _decode_hs(token: str, alg: str) -> dict:
    secret = settings.SUPABASE_JWT_SECRET
    if not secret:
        raise HTTPException(status_code=500, detail="Server auth not configured")
    return jwt.decode(
        token,
        secret,
        algorithms=[alg],
        options={"verify_aud": False},
    )


def _decode_jwks(token: str, alg: str | None) -> dict:
    if not settings.SUPABASE_URL:
        raise HTTPException(status_code=500, detail="Server auth not configured")
    base = settings.SUPABASE_URL.rstrip("/")
    jwks_urls = [
        f"{base}/auth/v1/.well-known/jwks.json",  # Supabase doc-supported endpoint
        f"{base}/auth/v1/keys",  # legacy/compat (some projects still use this)
    ]

    headers = None
    if settings.SUPABASE_ANON_KEY:
        headers = {
            "apikey": settings.SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {settings.SUPABASE_ANON_KEY}",
        }

    last_err: Exception | None = None
    for jwks_url in jwks_urls:
        try:
            jwk_client = PyJWKClient(jwks_url, headers=headers)
            signing_key = jwk_client.get_signing_key_from_jwt(token).key
            return jwt.decode(
                token,
                signing_key,
                algorithms=[alg or "RS256"],
                options={"verify_aud": False},
            )
        except Exception as exc:
            last_err = exc
            logger.warning("JWKS fetch/verify failed for %s: %s", jwks_url, exc)

    raise HTTPException(status_code=401, detail="Invalid token") from last_err


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg and alg.startswith("HS"):
            payload = _decode_hs(token, alg)
        else:
            payload = _decode_jwks(token, alg)
    except jwt.PyJWTError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    return user_id
