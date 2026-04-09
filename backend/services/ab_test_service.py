"""A/B test infrastructure: deterministic variant assignment and CTR tracking."""

import hashlib

from core.constants import (
    AB_DEFAULT_VARIANTS,
    AB_EVENT_CLICK,
    AB_EVENT_IMPRESSION,
    AB_VARIANT_CONTROL,
    AB_VARIANT_TREATMENT,
)
from core.database import get_sb
from core.tables import AB_TEST_EVENTS


class ABTestService:
    def __init__(
        self,
        experiment_name: str = "recommendations_v1",
        variants: tuple[str, ...] = AB_DEFAULT_VARIANTS,
        treatment_ratio: float = 0.5,
    ):
        self.experiment_name = experiment_name
        self.variants = variants
        self.treatment_ratio = treatment_ratio

    def get_user_variant(self, user_id: str) -> str:
        """Deterministic variant assignment based on user_id hash."""
        h = hashlib.sha256(f"{self.experiment_name}:{user_id}".encode()).hexdigest()
        bucket = int(h[:8], 16) / 0xFFFFFFFF
        return AB_VARIANT_TREATMENT if bucket < self.treatment_ratio else AB_VARIANT_CONTROL

    def record_impression(self, user_id: str, event_id: int, variant: str) -> None:
        """Record that an event was shown to the user."""
        get_sb().table(AB_TEST_EVENTS).insert([{
            "user_id": user_id,
            "event_id": event_id,
            "variant": variant,
            "event_type": AB_EVENT_IMPRESSION,
            "experiment_name": self.experiment_name,
        }]).execute()

    def record_impressions(self, user_id: str, event_ids: list[int], variant: str) -> None:
        """Batch-record impressions for multiple events in a single insert."""
        if not event_ids:
            return
        rows = [
            {
                "user_id": user_id,
                "event_id": eid,
                "variant": variant,
                "event_type": AB_EVENT_IMPRESSION,
                "experiment_name": self.experiment_name,
            }
            for eid in event_ids
        ]
        get_sb().table(AB_TEST_EVENTS).insert(rows).execute()

    def record_click(self, user_id: str, event_id: int, variant: str) -> None:
        """Record that the user clicked on a recommended event."""
        get_sb().table(AB_TEST_EVENTS).insert([{
            "user_id": user_id,
            "event_id": event_id,
            "variant": variant,
            "event_type": AB_EVENT_CLICK,
            "experiment_name": self.experiment_name,
        }]).execute()

    def get_ctr_by_variant(self) -> dict[str, dict]:
        """Compute click-through rate per variant.

        Uses a server-side RPC function (``get_ab_test_ctr``) that aggregates
        counts with ``GROUP BY`` in a single database query, filtered by
        ``experiment_name``.  This replaces the previous client-side pagination
        loop that fetched all rows in 1000-row pages.
        """
        r = get_sb().rpc(
            "get_ab_test_ctr",
            {"p_experiment_name": self.experiment_name},
        ).execute()

        # Build result dict, starting with zeros for all known variants
        # so the response always includes both even if one has no data yet.
        result: dict[str, dict] = {
            v: {"impressions": 0, "clicks": 0, "ctr": 0.0}
            for v in self.variants
        }

        for row in r.data or []:
            variant = row["variant"]
            if variant not in result:
                continue
            imp = row["impressions"]
            clicks = row["clicks"]
            result[variant] = {
                "impressions": imp,
                "clicks": clicks,
                "ctr": round(clicks / imp, 4) if imp > 0 else 0.0,
            }

        return result


ab_test = ABTestService()
