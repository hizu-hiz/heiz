from datetime import datetime

from sqlalchemy import CHAR, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, BigIntPK


class Region(Base):
    """Mapped for completeness. Not populated: no reliable region source yet."""
    __tablename__ = "regions"
    __table_args__ = (UniqueConstraint("name", "region_type", "country_code"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    region_type: Mapped[str] = mapped_column(String(50), default="area")
    country_code: Mapped[str] = mapped_column(CHAR(2), default="ID")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class EventRegion(Base):
    __tablename__ = "event_regions"

    event_id: Mapped[int] = mapped_column(
        BigIntPK, ForeignKey("earthquake_events.id", ondelete="CASCADE"), primary_key=True)
    region_id: Mapped[int] = mapped_column(
        BigIntPK, ForeignKey("regions.id", ondelete="RESTRICT"), primary_key=True)
    relationship_type: Mapped[str] = mapped_column("relationship", String(50),
                                                   default="reported_location")
