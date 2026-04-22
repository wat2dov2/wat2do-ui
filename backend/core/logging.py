"""Process-wide logging configuration.

Runs at import time via ``basicConfig(force=True)`` so the project's
formatter always wins — even when an upstream (uvicorn, gunicorn,
pytest) has already added its own handler.  Without ``force=True``
``basicConfig`` is a no-op on a pre-configured root logger, which
causes log lines to appear without the expected prefix and breaks
structured-log parsers downstream (E18).
"""

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    force=True,
)

logger = logging.getLogger(__name__)
