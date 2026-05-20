"""A/B test infrastructure: deterministic variant assignment and CTR tracking."""

import hashlib
import logging

from core.cache import TTLCache
from core.constants import (
    AB_DEFAULT_VARIANTS,
    AB_EVENT_CLICK,
    AB_EVENT_IMPRESSION,
    AB_VARIANT_CONTROL,
    AB_VARIANT_TREATMENT,
)
from core.database import get_sb
from core.tables import AB_TEST_EVENTS

log = logging.getLogger(__name__)

# Table that persists sticky (user, experiment) -> variant assignments.
# Created in migration 20260416007_create_ab_assignments.sql.
AB_ASSIGNMENTS = "ab_assignments"

# Short-TTL cache for /ab/metrics so admin dashboards polling every 2-5s
# don't generate a full table scan per poll (M15).
_metrics_cache = TTLCache(default_ttl=60)


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

    # ------------------------------------------------------------------
    # Variant assignment
    # ------------------------------------------------------------------

    def _compute_variant(self, user_id: str) -> str:
        """Deterministic variant assignment based on user_id hash.

        Divides by ``1 << 32`` (i.e. 2**32) so the bucket value lies in
        the half-open interval ``[0, 1)``.  Using ``0xFFFFFFFF`` (2**32 − 1)
        would produce ``[0, 1]`` inclusive, causing the edge case where a
        user with hash == 0xFFFFFFFF is assigned control even when
        ``treatment_ratio == 1.0`` (M1).
        """
        h = hashlib.sha256(f"{self.experiment_name}:{user_id}".encode()).hexdigest()
        bucket = int(h[:8], 16) / (1 << 32)
        return AB_VARIANT_TREATMENT if bucket < self.treatment_ratio else AB_VARIANT_CONTROL

    def get_user_variant(self, user_id: str) -> str:
        """Return the sticky variant for *user_id* under the current experiment.

        Looks up any persisted assignment in ``ab_assignments`` first so a
        user's variant never changes across deploys or experiment-name
        transitions (M2).  If no row exists, computes a fresh assignment
        from the deterministic hash and inserts it so subsequent calls
        return the same variant.  A DB failure during lookup or insert
        degrades to the computed hash — the function never raises, so
        variant resolution stays non-blocking for the request path.
        """
        sb = get_sb()
        try:
            r = (
                sb.table(AB_ASSIGNMENTS)
                .select("variant")
                .eq("user_id", user_id)
                .eq("experiment_name", self.experiment_name)
                .limit(1)
                .execute()
            )
            rows = r.data or []
            if rows:
                variant = rows[0].get("variant")
                if variant in self.variants:
                    return variant
        except Exception as e:
            log.warning(
                "Failed to look up AB assignment for user %s in %s, falling back to hash: %s",
                user_id,
                self.experiment_name,
                e,
            )
            return self._compute_variant(user_id)

        variant = self._compute_variant(user_id)
        try:
            sb.table(AB_ASSIGNMENTS).insert(
                {
                    "user_id": user_id,
                    "experiment_name": self.experiment_name,
                    "variant": variant,
                }
            ).execute()
        except Exception as e:
            # Race between concurrent assigns resolves via unique key on
            # (user_id, experiment_name); subsequent lookups will see the
            # winning row.  Anything else is non-fatal — the caller still
            # gets a deterministic variant from the hash.
            log.warning(
                "Failed to persist AB assignment for user %s in %s: %s",
                user_id,
                self.experiment_name,
                e,
            )
        return variant

    # ------------------------------------------------------------------
    # Event recording
    # ------------------------------------------------------------------

    def record_impression(self, user_id: str, event_id: int, variant: str) -> None:
        """Record that an event was shown to the user."""
        get_sb().table(AB_TEST_EVENTS).insert(
            [
                {
                    "user_id": user_id,
                    "event_id": event_id,
                    "variant": variant,
                    "event_type": AB_EVENT_IMPRESSION,
                    "experiment_name": self.experiment_name,
                }
            ]
        ).execute()

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
        get_sb().table(AB_TEST_EVENTS).insert(
            [
                {
                    "user_id": user_id,
                    "event_id": event_id,
                    "variant": variant,
                    "event_type": AB_EVENT_CLICK,
                    "experiment_name": self.experiment_name,
                }
            ]
        ).execute()

    # ------------------------------------------------------------------
    # Metrics
    # ------------------------------------------------------------------

    def get_ctr_by_variant(self) -> dict[str, dict]:
        """Compute click-through rate per variant.

        Uses a server-side RPC function (``get_ab_test_ctr``) that aggregates
        counts with ``GROUP BY`` in a single database query, filtered by
        ``experiment_name``.  This replaces the previous client-side pagination
        loop that fetched all rows in 1000-row pages.

        Cached in-process for 60 s (``_metrics_cache``) so admin dashboards
        polling the endpoint every few seconds don't trigger a full scan
        of ``ab_test_events`` per poll (M15).
        """
        cache_key = f"ctr:{self.experiment_name}"
        return _metrics_cache.get_or_compute(cache_key, self._compute_ctr_by_variant)

    def _compute_ctr_by_variant(self) -> dict[str, dict]:
        r = (
            get_sb()
            .rpc(
                "get_ab_test_ctr",
                {"p_experiment_name": self.experiment_name},
            )
            .execute()
        )

        # Build result dict, starting with zeros for all known variants
        # so the response always includes both even if one has no data yet.
        result: dict[str, dict] = {
            v: {"impressions": 0, "clicks": 0, "ctr": 0.0} for v in self.variants
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
