"""Next.js discovery cache invalidation gateway.

The frontend acknowledges a request only after recording durable school/resource
refresh state. Backend mutations notify it after the database commit succeeds.
This gateway remains fail-open so a successful write survives a delivery outage;
periodic frontend reconciliation repairs missed notifications.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Literal

import httpx

from core.config import settings

log = logging.getLogger(__name__)
DiscoveryResource = Literal["events", "positions", "clubs", "branding", "schools"]


class EventFeedRevalidationService:
    def revalidate_school(
        self,
        school: str | None,
        *,
        resources: Sequence[DiscoveryResource],
    ) -> None:
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

        payload: dict[str, object] = {"school": school, "resources": list(dict.fromkeys(resources))}

        try:
            response = httpx.post(
                url,
                json=payload,
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

    def revalidate_schools(
        self,
        schools: Sequence[str | None],
        *,
        resources: Sequence[DiscoveryResource],
    ) -> None:
        seen: set[str] = set()
        for school in schools:
            if not school or school in seen:
                continue
            seen.add(school)
            self.revalidate_school(school, resources=resources)


event_feed_revalidation_service = EventFeedRevalidationService()
