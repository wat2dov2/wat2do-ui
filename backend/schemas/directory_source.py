"""Official school event directories read by the directory agents."""

from pydantic import BaseModel


class DirectorySource(BaseModel):
    id: int
    school: str
    name: str
    url: str
    default_club: str
    default_club_ig: str | None = None
