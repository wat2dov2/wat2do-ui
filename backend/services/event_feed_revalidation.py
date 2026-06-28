"""Next.js event-feed cache invalidation gateway.

The frontend owns ISR cache state. Backend event writes call this service after
the database commit has succeeded so cached school homepages regenerate on the
next request. The service is intentionally fail-open: event writes must not fail
because the frontend cache endpoint is temporarily unavailable.
"""

from __future__ import annotations

import logging

import httpx

from core.config import settings

log = logging.getLogger(__name__)


class EventFeedRevalidationService:
    def revalidate_school(self, school: str | None) -> None:
        if not school:
            return

        url = settings.event_feed_revalidation_url.strip()
        if not url:
            log.debug("[event-feed-revalidation][dry-run] school=%s", school)
            return

        headers: dict[str, str] = {}
        secret = settings.event_feed_revalidation_secret.strip()
        if secret:
            headers["Authorization"] = f"Bearer {secret}"

        try:
            response = httpx.post(
                url,
                json={"school": school},
                headers=headers,
                timeout=settings.event_feed_revalidation_timeout,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning(
                "Event feed revalidation failed for school=%s: %s",
                school,
                exc,
            )

    def revalidate_schools(self, schools: list[str | None]) -> None:
        seen: set[str] = set()
        for school in schools:
            if not school or school in seen:
                continue
            seen.add(school)
            self.revalidate_school(school)


event_feed_revalidation_service = EventFeedRevalidationService()
