"""Queue the posts of a manually requested Instagram profile.

Listing a profile's recent posts is the one retrieval Brave still does, because
it needs the login. Each listed post joins the Supabase ingestion queue, where
the logged-out fetcher and the processor take over, as for any notified post.
"""

from __future__ import annotations

from services.ingestion import items
from services.instagram_notifications.browser_queue import BrowserJobQueue
from services.instagram_notifications.browser_session import canonical_post_url


def queue_retrieved_profiles(queue: BrowserJobQueue) -> dict[str, int]:
    stats = {"queued": 0, "invalid": 0}
    for job in queue.retrieval_results():
        key = f"profile_queued:{job.id}"
        if (
            not queue.get_setting(f"profile_request:{job.id}")
            or queue.account_excluded(job.account_username)
            or queue.get_setting(key)
        ):
            continue
        result = job.result or {}
        posts = result.get("posts")
        if result.get("target_url") != job.payload["url"] or not isinstance(posts, list):
            stats["invalid"] += 1
            continue
        urls = [canonical_post_url(post["url"]) for post in posts if isinstance(post, dict)]
        stats["queued"] += items.queue_instagram(urls, school=job.school)
        queue.set_setting(key, True)
    return stats
