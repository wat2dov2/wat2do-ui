from pydantic import BaseModel


class ClubCreate(BaseModel):
    club_name: str
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: str
    logo_url: str | None = None


class ClubUpdate(BaseModel):
    club_name: str | None = None
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: str | None = None
    logo_url: str | None = None


class ClubResponse(BaseModel):
    id: int
    club_name: str
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: str
    logo_url: str | None = None

    model_config = {"from_attributes": True}
