"""Uniform JSON errors: {"error": {"code", "message", "details"?}}."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("heiz")
RETRY_AFTER_SECONDS = 30


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str,
                 details=None, headers: dict | None = None):
        self.status_code, self.code, self.message = status_code, code, message
        self.details, self.headers = details, headers


def _body(code: str, message: str, details=None) -> dict:
    err = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    return {"error": err}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(_body(exc.code, exc.message, exc.details),
                            status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "problem": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(_body("validation_error", "The request is invalid.", details),
                            status_code=400)

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_: Request, exc: IntegrityError):
        log.warning("integrity error: %s", type(exc.orig).__name__)
        return JSONResponse(
            _body("conflict", "The change conflicts with an existing record or a database rule."),
            status_code=409)

    @app.exception_handler(DBAPIError)
    async def _db_unavailable(_: Request, exc: DBAPIError):
        """Connection-level failures (paused/overloaded free-tier DB). UIs should retry with backoff."""
        log.error("database unavailable: %s", type(exc.orig).__name__)
        body = _body("database_unavailable",
                     "The database is temporarily unavailable. Try again shortly.")
        body["error"].update(retryable=True, retry_after_seconds=RETRY_AFTER_SECONDS)
        return JSONResponse(body, status_code=503,
                            headers={"Retry-After": str(RETRY_AFTER_SECONDS)})

    @app.exception_handler(SQLAlchemyError)
    async def _db_error(_: Request, exc: SQLAlchemyError):
        log.error("database error: %s", type(exc).__name__)
        return JSONResponse(_body("database_error", "A database error occurred."), status_code=500)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")  # stack trace goes to server logs only
        return JSONResponse(_body("internal_error", "An unexpected error occurred."),
                            status_code=500)
