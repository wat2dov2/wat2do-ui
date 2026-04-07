"""A/B test infrastructure: deterministic variant assignment and CTR tracking."""

import hashlib

from core.database import get_sb


class ABTestService:
    def __init__(
        self,
        experiment_name: str = "recommendations_v1",
        variants: tuple[str, ...] = ("control", "treatment"),
        treatment_ratio: float = 0.5,
    ):
        self.experiment_name = experiment_name
        self.variants = variants
        self.treatment_ratio = treatment_ratio

    def get_user_variant(self, user_id: str) -> str:
        """Deterministic variant assignment based on user_id hash."""
        h = hashlib.sha256(f"{self.experiment_name}:{user_id}".encode()).hexdigest()
        bucket = int(h[:8], 16) / 0xFFFFFFFF
        return "treatment" if bucket < self.treatment_ratio else "control"

    def record_impression(self, user_id: str, event_id: int, variant: str) -> None:
        """Record that an event was shown to the user."""
        get_sb().table("ab_test_events").insert([{
            "user_id": user_id,
            "event_id": event_id,
            "variant": variant,
            "event_type": "impression",
        }]).execute()

    def record_impressions(self, user_id: str, event_ids: list[int], variant: str) -> None:
        """Batch-record impressions for multiple events in a single insert."""
        if not event_ids:
            return
        rows = [
            {"user_id": user_id, "event_id": eid, "variant": variant, "event_type": "impression"}
            for eid in event_ids
        ]
        get_sb().table("ab_test_events").insert(rows).execute()

    def record_click(self, user_id: str, event_id: int, variant: str) -> None:
        """Record that the user clicked on a recommended event."""
        get_sb().table("ab_test_events").insert([{
            "user_id": user_id,
            "event_id": event_id,
            "variant": variant,
            "event_type": "click",
        }]).execute()

    def get_ctr_by_variant(self) -> dict[str, dict]:
        """Compute click-through rate per variant."""
        r = get_sb().table("ab_test_events").select("variant, event_type").execute()

        counts: dict[str, dict[str, int]] = {
            v: {"impressions": 0, "clicks": 0} for v in self.variants
        }
        for row in r.data or []:
            variant = row["variant"]
            if variant not in counts:
                continue
            if row["event_type"] == "impression":
                counts[variant]["impressions"] += 1
            elif row["event_type"] == "click":
                counts[variant]["clicks"] += 1

        result = {}
        for variant, data in counts.items():
            imp = data["impressions"]
            clicks = data["clicks"]
            result[variant] = {
                "impressions": imp,
                "clicks": clicks,
                "ctr": round(clicks / imp, 4) if imp > 0 else 0.0,
            }
        return result


ab_test = ABTestService()
