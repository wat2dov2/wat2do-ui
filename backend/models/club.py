from sqlalchemy import Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.user import Base


class Club(Base):
    __tablename__ = "clubs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    club_name: Mapped[str] = mapped_column(String(500), nullable=False)
    categories: Mapped[list | None] = mapped_column(JSONB, default=list)
    club_page: Mapped[str | None] = mapped_column(String(500))
    ig: Mapped[str | None] = mapped_column(String(255))
    discord: Mapped[str | None] = mapped_column(String(255))
    club_type: Mapped[str] = mapped_column(String(100), nullable=False)
    logo_url: Mapped[str | None] = mapped_column(String(1024))

    def __repr__(self) -> str:
        return f"<Club {self.id}: {self.club_name}>"
