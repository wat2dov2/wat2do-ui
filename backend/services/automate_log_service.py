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
) -> bool:

    insert_data = {
        "event": event,
        "sender_id": sender_id,
        "school": school,
        "ig_account": ig_account,
        "post_url": post_url,
        "payload": payload,
    }
    try:
        get_sb().table("automate_logs").insert(insert_data).execute()
        return True
    except Exception as e:
        log.warning("Failed to insert automate log into database (%s)", type(e).__name__)
        return False


def get_automate_logs(limit: int = 50, sender_id: str | None = None) -> list[dict[str, Any]]:
    supabase = get_sb()
    query = supabase.table("automate_logs").select("*").order("created_at", desc=True).limit(limit)
    if sender_id:
        query = query.eq("sender_id", sender_id)
    return query.execute().data
