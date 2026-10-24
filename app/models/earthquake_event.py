from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BigIntPK, JsonType
from app.models.data_source import DataSource


class EarthquakeEvent(Base):
    __tablename__ = "earthquake_events"
    __table_args__ = (UniqueConstraint("source_id", "source_event_id"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("data_sources.id", ondelete="RESTRICT"))
    source_event_id: Mapped[str | None] = mapped_column(String(200))
    last_sync_id: Mapped[int | None] = mapped_column(ForeignKey("sync_logs.id", ondelete="SET NULL"))
    occurred_at: Mapped[datetime | None]
    source_reported_at: Mapped[datetime | None]
    location_description: Mapped[str] = mapped_column(Text)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    magnitude: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    depth_km: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    tsunami_potential: Mapped[bool | None] = mapped_column(Boolean)
    source_url: Mapped[str | None] = mapped_column(Text)
    source_attribution: Mapped[str] = mapped_column(String(200), default="BMKG")
    raw_payload: Mapped[dict | None] = mapped_column(JsonType)
    imported_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    source: Mapped[DataSource] = relationship(lazy="joined")

    @property
    def source_code(self) -> str:
        return self.source.code
