"""Credit and promotion package constants."""

DEFAULT_CREDIT_BALANCE = 100
MAX_CREDITS_PER_ADD = 10_000

# Organizations can buy one simple event visibility boost.
DEFAULT_PROMOTION_PACKAGE = "featured"

# Server-authoritative promotion pricing: package -> (credits, days).
PROMOTION_PACKAGES: dict[str, tuple[int, int]] = {
    DEFAULT_PROMOTION_PACKAGE: (50, 7),
}
