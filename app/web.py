"""Serving the front end: pages with strict headers, and static assets with a FIXED Content-Type map.

Why the fixed map: Starlette guesses types with Python's `mimetypes`, which on Windows reads the registry.
A machine whose registry maps `.js` to `text/plain` then serves scripts that browsers refuse to run
(X-Content-Type-Options: nosniff), which looked like a blank map and dead buttons. Types are therefore
decided here, not by the host OS.
"""
from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

WEB = Path(__file__).resolve().parent.parent / "web"

# Scripts only from our own origin; forms cannot submit anywhere (the login uses fetch(), never a form post).
PAGE_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; "
    "img-src 'self' data: https://server.arcgisonline.com "
    "https://*.tile.opentopomap.org https://static.bmkg.go.id; connect-src 'self'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)

CONTENT_TYPES = {
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
    ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
}


class AssetFiles(StaticFiles):
    """StaticFiles that ignores the host's MIME registry and revalidates instead of guessing at caching."""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        media = CONTENT_TYPES.get(Path(str(full_path)).suffix.lower())
        if media and "content-type" in response.headers:
            response.headers["content-type"] = media
        response.headers["Cache-Control"] = "no-cache"
        return response


def page(relative: str, *, noindex: bool = False, no_store: bool = False) -> FileResponse:
    headers = {"Content-Security-Policy": PAGE_CSP, "X-Frame-Options": "DENY", "Cache-Control": "no-cache"}
    if noindex:
        headers["X-Robots-Tag"] = "noindex, nofollow"
    if no_store:
        headers["Cache-Control"] = "no-store"
    return FileResponse(WEB / relative, media_type="text/html; charset=utf-8", headers=headers)
