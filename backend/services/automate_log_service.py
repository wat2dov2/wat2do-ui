import logging
from typing import Any

from core.database import get_sb

log = logging.getLogger(__name__)


def create_automate_log(
    event: str,
    sender_id: str | None,
    school: str | None,
    ig_account: str | None,
    post_url: str | None,
    payload: dict[str, Any] | None,
) -> None:
    supabase = get_sb()

    insert_data = {
        "event": event,
        "sender_id": sender_id,
        "school": school,
        "ig_account": ig_account,
        "post_url": post_url,
        "payload": payload,
    }
    try:
        supabase.table("automate_logs").insert(insert_data).execute()
    except Exception as e:
        log.warning("Failed to insert automate log into database: %s", e)


def get_automate_logs(limit: int = 50) -> list[dict[str, Any]]:
    supabase = get_sb()
    response = (
        supabase.table("automate_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data
