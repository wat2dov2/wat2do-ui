"""Interaction types and the default interaction query limit."""

from core.controlbox import controlbox

_CONTROL = controlbox.interaction_ingestion

DEFAULT_INTERACTION_LIMIT = _CONTROL.default_query_limit

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
