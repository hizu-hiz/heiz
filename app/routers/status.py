"""Public status for UIs. ALWAYS answers 200 so a front end can show 'database down' instead of failing."""
import time
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import get_engine
from app.errors import AppError, RETRY_AFTER_SECONDS

router = APIRouter(tags=["health"])


@router.get("/api/status")
def api_status():
    """`database` is one of: ok | unavailable | not_configured. Never returns 5xx."""
    state, started = "ok", time.monotonic()
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except AppError:
        state = "not_configured"
    except SQLAlchemyError:
        state = "unavailable"
    body = {"api": "ok", "database": state,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "checked_at": datetime.now(timezone.utc).isoformat()}
    if state == "unavailable":
        body["retry_after_seconds"] = RETRY_AFTER_SECONDS
    return JSONResponse(body, headers={"Cache-Control": "no-store"})
