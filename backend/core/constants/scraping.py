"""Scraping pipeline constants."""

from typing import Final

from core.product_control import product_control

_CONTROL = product_control.scraping

SCRAPING_APIFY_TIMEOUT_SECONDS = _CONTROL.apify_timeout_seconds
SCRAPING_POLL_INTERVAL_SECONDS = _CONTROL.poll_interval_seconds

SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD = _CONTROL.same_organization_title_threshold
SCRAPING_TITLE_SIMILARITY_THRESHOLD = _CONTROL.title_similarity_threshold
SCRAPING_LOCATION_SIMILARITY_THRESHOLD = _CONTROL.location_similarity_threshold
SCRAPING_DESCRIPTION_SIMILARITY_THRESHOLD = _CONTROL.description_similarity_threshold
# Cap on candidate rows fed to Pass 2 reconcile. Keeps the prompt bounded.
SCRAPING_MAX_CANDIDATES = _CONTROL.maximum_candidates
# Same-day cross-org recall is capped tighter than same-org so Pass 2
# is not flooded with unrelated campus events on busy days.
SCRAPING_MAX_CROSS_ORG_CANDIDATES = _CONTROL.maximum_cross_organization_candidates

WORKFLOW_RUN_RUNNING: Final = "running"
WORKFLOW_RUN_SUCCESS: Final = "success"
WORKFLOW_RUN_ERROR: Final = "error"
WORKFLOW_RUN_NO_POSTS: Final = "no_posts"
