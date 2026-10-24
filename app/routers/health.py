from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """Liveness only: does not touch the database."""
    return {"status": "ok", "service": "heiz"}


@router.get("/health/db")
def health_db(db: Session = Depends(get_db)):
    """Readiness: proves the API can reach PostgreSQL. 503 (via the error handlers) if not."""
    db.execute(text("SELECT 1"))
    return JSONResponse({"status": "ok", "database": "reachable"})
