"""Process-wide logging configuration.

Runs at import time via ``basicConfig(force=True)`` so the project's
formatter always wins - even when an upstream (uvicorn, gunicorn,
pytest) has already added its own handler.  Without ``force=True``
``basicConfig`` is a no-op on a pre-configured root logger, which
causes log lines to appear without the expected prefix and breaks
structured-log parsers downstream.
"""

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    force=True,
)

logger = logging.getLogger(__name__)


class GitHubActionErrorHandler(logging.Handler):
    """Buffer errors and flush them as GitHub action workflow annotations on exit.

    GitHub Actions imposes a limit of 10 annotations per step. This handler
    compacts all errors generated during the script's execution into a single
    workflow annotation to guarantee visibility without hitting the limit.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setLevel(logging.ERROR)
        self._errors: list[str] = []
        import atexit

        atexit.register(self._flush)

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        self._errors.append(msg)

    def _flush(self) -> None:
        if not self._errors:
            return
        import os
        import sys

        if os.getenv("GITHUB_ACTIONS") == "true":
            compacted = " \\n".join(msg.replace("\n", " ") for msg in self._errors)
            print(f"::error::{compacted}", file=sys.stderr)
