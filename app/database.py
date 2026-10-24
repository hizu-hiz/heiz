"""Database engine/session. The engine is created lazily so imports never need a DB."""
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.errors import AppError


def normalize_url(url: str) -> str:
    """Make a Supabase/Heroku style URL use the psycopg (v3) SQLAlchemy driver."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


@lru_cache
def get_engine() -> Engine:
    secret = get_settings().database_url
    if secret is None:
        raise AppError(503, "database_not_configured", "The database is not configured.")
    return create_engine(
        normalize_url(secret.get_secret_value()),
        # Serverless: let Supabase's pooler do the pooling, keep no idle connections here.
        poolclass=NullPool,
        # prepare_threshold=None keeps psycopg compatible with PgBouncer transaction mode.
        connect_args={"prepare_threshold": None, "connect_timeout": 10},
    )


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    factory = sessionmaker(bind=get_engine(), expire_on_commit=False)
    with factory() as session:
        yield session
