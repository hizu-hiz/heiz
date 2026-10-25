"""Developer dashboard: a login page, a session endpoint, and the cookie-gated dashboard shell.

    /dashboard/                          login page (public, holds no data or secrets)
    POST /api/admin/session              verifies the Bearer token, sets the signed page cookie, returns the page URL
    DELETE /api/admin/session            clears the cookie
    /dashboard/dashboard-<id>.html       the dashboard shell: 404 without a valid cookie
"""
import hmac

from fastapi import APIRouter, Header, Request, Response
from fastapi.responses import RedirectResponse

from app import security
from app.errors import AppError
from app.web import page

router = APIRouter(include_in_schema=False)
api = APIRouter(prefix="/api/admin", tags=["admin"])


def _secure(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"


@router.get("/dashboard")
def dashboard_redirect():
    return RedirectResponse("/dashboard/", status_code=308)


@router.get("/dashboard/")
def dashboard_login():
    return page("dashboard/login.html", noindex=True, no_store=True)


@router.get("/dashboard/{name}")
def dashboard_shell(name: str, request: Request):
    did = security.dashboard_id()
    wanted = f"dashboard-{did}.html" if did else None
    if (wanted is None or not hmac.compare_digest(name.encode(), wanted.encode())
            or not security.session_valid(request.cookies.get(security.COOKIE_NAME))):
        # Same answer for "wrong name" and "no session": the page's existence is not revealed.
        raise AppError(404, "not_found", "Not found.")
    return page("dashboard/shell.html", noindex=True, no_store=True)


@api.post("/session")
def create_session(request: Request, response: Response, authorization: str | None = Header(default=None)):
    ip = security.client_ip(request)
    security.login_throttle(ip)
    try:
        security.require_admin(authorization)
    except AppError as exc:
        if exc.status_code == 401:
            security.login_failed(ip)
        raise
    security.login_succeeded(ip)
    value, ttl = security.issue_session()
    response.set_cookie(security.COOKIE_NAME, value, max_age=ttl, path=security.COOKIE_PATH,
                        httponly=True, samesite="strict", secure=_secure(request))
    return {"role": "admin", "dashboard_url": f"/dashboard/dashboard-{security.dashboard_id()}.html",
            "expires_in": ttl}


@api.delete("/session", status_code=204)
def end_session(response: Response):
    response.delete_cookie(security.COOKIE_NAME, path=security.COOKIE_PATH)
    response.status_code = 204
