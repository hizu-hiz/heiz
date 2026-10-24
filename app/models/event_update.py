from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, BigIntPK, JsonType


class EventUpdate(Base):
    __tablename__ = "event_updates"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("earthquake_events.id", ondelete="CASCADE"))
    sync_log_id: Mapped[int | None] = mapped_column(ForeignKey("sync_logs.id", ondelete="SET NULL"))
    change_type: Mapped[str] = mapped_column(String(30))
    changed_at: Mapped[datetime] = mapped_column(server_default=func.now())
    changed_fields: Mapped[dict] = mapped_column(JsonType, default=dict)
    note: Mapped[str | None] = mapped_column(Text)
