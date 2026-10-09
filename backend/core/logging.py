"""Default logging for entrypoints that have not configured their own handlers.

Late service imports must preserve an entrypoint's logging destination and level,
including the browser worker's bounded operational log.
"""

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
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
        import os

        if "PYTEST_CURRENT_TEST" in os.environ:
            return
        msg = self.format(record)
        self._errors.append(msg)

    def _flush(self) -> None:
        import os
        import sys

        if "PYTEST_CURRENT_TEST" in os.environ or not self._errors:
            return

        if os.getenv("GITHUB_ACTIONS") == "true":
            compacted = " \\n".join(msg.replace("\n", " ") for msg in self._errors)
            print(f"::error::{compacted}", file=sys.stderr)
