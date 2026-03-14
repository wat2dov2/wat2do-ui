from datetime import datetime

from sqlalchemy import Integer, String, DateTime, Float, Boolean, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.user import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(500), nullable=False)

    dtstart_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dtend_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    price: Mapped[float | None] = mapped_column(Float)
    food: Mapped[list | None] = mapped_column(JSONB)
    registration: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    source_image_url: Mapped[str | None] = mapped_column(String(1024))
    club_type: Mapped[str | None] = mapped_column(String(100))
    school: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    category: Mapped[str | None] = mapped_column(String(100))
    organization: Mapped[str | None] = mapped_column(String(255))

    ig_handle: Mapped[str | None] = mapped_column(String(255))
    discord_handle: Mapped[str | None] = mapped_column(String(255))
    x_handle: Mapped[str | None] = mapped_column(String(255))
    tiktok_handle: Mapped[str | None] = mapped_column(String(255))
    fb_handle: Mapped[str | None] = mapped_column(String(255))
    other_handle: Mapped[str | None] = mapped_column(String(255))
    display_handle: Mapped[str | None] = mapped_column(String(255))

    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<Event {self.id}: {self.title}>"
