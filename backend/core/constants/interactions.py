"""Interaction event constants and abuse-prevention bounds."""

from core.product_control import product_control

_CONTROL = product_control.interaction_ingestion

DEFAULT_INTERACTION_LIMIT = _CONTROL.default_query_limit
MAX_INTERACTION_BATCH_SIZE = _CONTROL.maximum_batch_size
MAX_INTERACTION_METADATA_BYTES = _CONTROL.maximum_metadata_bytes

MAX_DUPLICATE_INTERACTIONS = _CONTROL.maximum_duplicates_per_window
DEDUP_WINDOW_MINUTES = _CONTROL.deduplication_window_minutes
MAX_USER_INTERACTIONS_PER_WINDOW = _CONTROL.maximum_user_interactions_per_window

INTERACTION_CLICK = "click"
INTERACTION_DETAIL_VIEW = "detail_view"
INTERACTION_GOING = "going"
INTERACTION_UNGOING = "ungoing"
INTERACTION_SHARE = "share"

INTERACTION_TYPES = (
    INTERACTION_CLICK,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_GOING,
    INTERACTION_UNGOING,
    INTERACTION_SHARE,
)
