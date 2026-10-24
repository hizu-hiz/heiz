"""Declarative base and column-type helpers (types fall back to SQLite for offline tests)."""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase

BigIntPK = BigInteger().with_variant(Integer, "sqlite")  # SQLite only autoincrements INTEGER
JsonType = JSONB().with_variant(JSON(), "sqlite")


class Base(DeclarativeBase):
    """Maps the EXISTING Supabase tables. The app never calls create_all() on production."""

    type_annotation_map = {datetime: DateTime(timezone=True)}  # all columns are TIMESTAMPTZ
