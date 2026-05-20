"""Credit and promotion package constants."""

DEFAULT_CREDIT_BALANCE = 100
MAX_CREDITS_PER_ADD = 10_000

# Server-authoritative promotion package pricing: package -> (credits, days).
PROMOTION_PACKAGES: dict[str, tuple[int, int]] = {
    "featured": (50, 7),
    "email": (100, 1),
    "combo": (200, 7),
}
