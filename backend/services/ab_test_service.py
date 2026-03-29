"""A/B test infrastructure: deterministic variant assignment and CTR tracking."""

import hashlib

from core.database import get_sb


# Experiment config
EXPERIMENT_NAME = "recommendations_v1"
VARIANTS = ("control", "treatment")
TREATMENT_RATIO = 0.5  # 50/50 split


def get_user_variant(user_id: str) -> str:
    """
    Deterministic variant assignment based on user_id hash.
    Same user always gets the same variant.
    """
    h = hashlib.sha256(f"{EXPERIMENT_NAME}:{user_id}".encode()).hexdigest()
    bucket = int(h[:8], 16) / 0xFFFFFFFF
    return "treatment" if bucket < TREATMENT_RATIO else "control"


def record_impression(user_id: str, event_id: int, variant: str) -> None:
    """Record that an event was shown to the user."""
    get_sb().table("ab_test_events").insert({
        "user_id": user_id,
        "event_id": event_id,
        "variant": variant,
        "event_type": "impression",
    }).execute()


def record_click(user_id: str, event_id: int, variant: str) -> None:
    """Record that the user clicked on a recommended event."""
    get_sb().table("ab_test_events").insert({
        "user_id": user_id,
        "event_id": event_id,
        "variant": variant,
        "event_type": "click",
    }).execute()


def get_ctr_by_variant() -> dict[str, dict]:
    """
    Compute click-through rate per variant.
    Returns {variant: {impressions, clicks, ctr}}.
    """
    r = get_sb().table("ab_test_events").select("variant, event_type").execute()

    counts: dict[str, dict[str, int]] = {
        v: {"impressions": 0, "clicks": 0} for v in VARIANTS
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
