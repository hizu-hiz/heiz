"""Minimal API-key protection for write and sync endpoints (implemented and tested)."""
import hmac

from fastapi import Header

from app.config import get_settings
from app.errors import AppError


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    configured = get_settings().heiz_api_key
    if configured is None:
        # Fail closed: without a configured key nobody can write.
        raise AppError(503, "writes_disabled",
                       "Write endpoints are disabled because HEIZ_API_KEY is not configured.")
    if x_api_key is None or not hmac.compare_digest(
        x_api_key.encode(), configured.get_secret_value().encode()
    ):
        raise AppError(401, "unauthorized", "A valid X-API-Key header is required.")
