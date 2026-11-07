"""Users (profile table) via the data API. Sync."""

import base64
import hashlib
from itertools import batched
from uuid import UUID

from core.database import get_sb
from core.tables import USERS
from schemas.user import UserResponse
from services import school_service

_USER_SELECT = f"*,{school_service.SCHOOL_SLUG_EMBED}"


def avatar_url_for_user(user_id: str, avatar_url: str | None = None) -> str:
    """Preserve uploaded photos, otherwise generate a stable, private identicon."""
    if avatar_url:
        return avatar_url
    digest = hashlib.sha256(user_id.encode()).digest()
    color = f"hsl({int.from_bytes(digest[:2]) % 360} 55% 42%)"
    cells = []
    for y in range(5):
        for x in range(3):
            if digest[2 + y * 3 + x] & 1:
                for column in {x, 4 - x}:
                    cells.append(f"M{10 + column * 16} {10 + y * 16}h16v16h-16z")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" fill="#f1f5f9"/>'
        f'<path fill="{color}" d="{"".join(cells)}"/></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _user_response(row: dict) -> UserResponse:
    return UserResponse.model_validate(
        {
            **school_service.with_school_slug(row),
            "avatar_url": avatar_url_for_user(str(row["id"]), row.get("avatar_url")),
        }
    )


def get_user(user_id: UUID) -> UserResponse | None:
    r = get_sb().table(USERS).select(_USER_SELECT).eq("id", str(user_id)).execute()
    if not r.data or len(r.data) == 0:
        return None
    return _user_response(r.data[0])


def get_user_by_auth_id(auth_id: str) -> UserResponse | None:
    r = get_sb().table(USERS).select(_USER_SELECT).eq("auth_id", auth_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return _user_response(r.data[0])


_LOAD_PAGE_SIZE = 1000


def get_users_by_ids(user_ids: list[str]) -> dict[str, UserResponse]:
    """Fetch profiles in bounded ID batches, omitting missing users."""
    if not user_ids:
        return {}

    result: dict[str, UserResponse] = {}

    for chunk in batched(user_ids, _LOAD_PAGE_SIZE):
        r = get_sb().table(USERS).select(_USER_SELECT).in_("id", chunk).execute()
        for row in r.data or []:
            user = _user_response(row)
            result[str(user.id)] = user

    return result
