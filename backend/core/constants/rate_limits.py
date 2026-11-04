"""Rate limit and per-user cap constants."""

from core.controlbox import controlbox

_CONTROL = controlbox.rate_limits

RATE_LIMIT_MAX_REQUESTS = _CONTROL.default.maximum_requests
RATE_LIMIT_WINDOW_SECONDS = _CONTROL.default.window_seconds


SUBMISSION_RATE_LIMIT_MAX_REQUESTS = _CONTROL.submissions.maximum_requests
SUBMISSION_RATE_LIMIT_WINDOW_SECONDS = _CONTROL.submissions.window_seconds

MAX_GOING_EVENTS_PER_USER = _CONTROL.maximum_going_events_per_user
MAX_SAVED_CLUBS_PER_USER = _CONTROL.maximum_saved_clubs_per_user
