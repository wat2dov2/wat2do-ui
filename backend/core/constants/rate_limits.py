"""Rate limit and per-user cap constants."""

from core.controlbox import controlbox

_CONTROL = controlbox.rate_limits

MAX_GOING_EVENTS_PER_USER = _CONTROL.maximum_going_events_per_user
MAX_SAVED_CLUBS_PER_USER = _CONTROL.maximum_saved_clubs_per_user
