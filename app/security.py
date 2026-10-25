"""Two secret tiers, both configured via environment variables (so auth still works when the DB is down).

* writer key  (HEIZ_API_KEY, header ``X-API-Key``): manual earthquake CRUD only. Safe to hand to a tester.
* admin token (HEIZ_ADMIN_TOKEN, header ``Authorization: Bearer``): everything, plus sync, maintenance
  and the dashboard endpoints.
Secrets shorter than MIN_SECRET_LENGTH are treated as NOT configured (fail closed).
"""
import hashlib
import hmac
import time

from fastapi import Header, Request
from pydantic import SecretStr

from app.config import get_settings
from app.errors import AppError

MIN_SECRET_LENGTH = 24


def _usable(secret: SecretStr | None) -> str | None:
    value = secret.get_secret_value() if secret else None
    return value if value and len(value) >= MIN_SECRET_LENGTH else None


def _same(a: str | None, b: str | None) -> bool:
    return a is not None and b is not None and hmac.compare_digest(a.encode(), b.encode())


def _bearer(header: str | None) -> str | None:
    if header and header[:7].lower() == "bearer ":
        return header[7:].strip() or None
    return None


def require_admin(authorization: str | None = Header(default=None)) -> None:
    admin = _usable(get_settings().heiz_admin_token)
    if admin is None:
        raise AppError(503, "admin_disabled",
                       "Admin endpoints are disabled because HEIZ_ADMIN_TOKEN is not configured "
                       f"(minimum {MIN_SECRET_LENGTH} characters).")
    if not _same(_bearer(authorization), admin):
        raise AppError(401, "unauthorized", "A valid admin bearer token is required.",
                       headers={"WWW-Authenticate": "Bearer"})


def require_writer(x_api_key: str | None = Header(default=None),
                   authorization: str | None = Header(default=None)) -> None:
    s = get_settings()
    writer, admin = _usable(s.heiz_api_key), _usable(s.heiz_admin_token)
    if writer is None and admin is None:
        raise AppError(503, "writes_disabled",
                       "Write endpoints are disabled because HEIZ_API_KEY is not configured "
                       f"(minimum {MIN_SECRET_LENGTH} characters).")
    if _same(x_api_key, writer) or _same(_bearer(authorization), admin):
        return
    raise AppError(401, "unauthorized", "A valid X-API-Key header is required.")


# Backwards-compatible name used by earlier code/tests.
require_api_key = require_writer


# The dashboard HTML shell is served only to a browser holding a signed cookie issued after the admin token
# was verified. This gates the *page* (and hides its URL); it is NOT API authorisation. Every data call still
# needs the Bearer token, and no endpoint accepts this cookie, so it cannot be abused for CSRF.
# Stateless (HMAC) so it works while the database is down; rotating HEIZ_ADMIN_TOKEN invalidates all sessions.
COOKIE_NAME = "heiz_dash"
COOKIE_PATH = "/dashboard"
SESSION_TTL_SECONDS = 8 * 3600


def _derive(label: bytes) -> bytes | None:
    secret = _usable(get_settings().heiz_admin_token)
    return hmac.new(secret.encode(), label, hashlib.sha256).digest() if secret else None


def dashboard_id() -> str | None:
    """Unguessable page id derived from the admin token: the shell lives at /dashboard/dashboard-<id>.html."""
    key = _derive(b"heiz-dashboard-id-v1")
    return key.hex()[:12] if key else None


def issue_session(now: float | None = None) -> tuple[str, int]:
    key = _derive(b"heiz-dashboard-session-v1")
    if key is None:
        raise AppError(503, "admin_disabled", "Admin endpoints are disabled because HEIZ_ADMIN_TOKEN is not configured.")
    message = f"v1.{int((now if now is not None else time.time())) + SESSION_TTL_SECONDS}"
    return f"{message}.{hmac.new(key, message.encode(), hashlib.sha256).hexdigest()}", SESSION_TTL_SECONDS


def session_valid(cookie: str | None, now: float | None = None) -> bool:
    key = _derive(b"heiz-dashboard-session-v1")
    if key is None or not cookie or len(cookie) > 200:
        return False
    parts = cookie.split(".")
    if len(parts) != 3 or parts[0] != "v1" or not parts[1].isdigit():
        return False
    expected = hmac.new(key, f"v1.{parts[1]}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts[2], expected) and int(parts[1]) > (now if now is not None else time.time())


# Best-effort brute-force brake on the login endpoint (per server instance; the token is long anyway).
LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS = 8, 600
_failures: dict[str, list[float]] = {}


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown"))[:64]


def login_throttle(ip: str, now: float | None = None) -> None:
    now = now if now is not None else time.time()
    recent = [t for t in _failures.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
    _failures[ip] = recent
    if len(recent) >= LOGIN_MAX_FAILURES:
        wait = int(LOGIN_WINDOW_SECONDS - (now - recent[0])) + 1
        raise AppError(429, "login_throttled", "Too many failed attempts. Wait before trying again.",
                       headers={"Retry-After": str(wait)})


def login_failed(ip: str, now: float | None = None) -> None:
    if len(_failures) > 1000:
        _failures.clear()
    _failures.setdefault(ip, []).append(now if now is not None else time.time())


def login_succeeded(ip: str) -> None:
    _failures.pop(ip, None)
