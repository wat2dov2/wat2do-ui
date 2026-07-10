"""Scraping pipeline constants."""

from typing import Final

SCRAPING_APIFY_TIMEOUT_SECONDS = 3600
SCRAPING_POLL_INTERVAL_SECONDS = 5

SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD = 0.8
SCRAPING_TITLE_SIMILARITY_THRESHOLD = 0.7
SCRAPING_LOCATION_SIMILARITY_THRESHOLD = 0.5
SCRAPING_DESCRIPTION_SIMILARITY_THRESHOLD = 0.3
# Cap on candidate rows fed to Pass 2 reconcile. Keeps the prompt bounded.
SCRAPING_MAX_CANDIDATES = 10
# Same-day cross-org recall is capped tighter than same-org so Pass 2
# is not flooded with unrelated campus events on busy days.
SCRAPING_MAX_CROSS_ORG_CANDIDATES = 3

WORKFLOW_RUN_RUNNING: Final = "running"
WORKFLOW_RUN_SUCCESS: Final = "success"
WORKFLOW_RUN_ERROR: Final = "error"
WORKFLOW_RUN_NO_POSTS: Final = "no_posts"
