"""Shared status constants for user-facing tables."""

from typing import Final

REPORT_PENDING: Final = "pending"
REPORT_RESOLVED: Final = "resolved"
REPORT_DISMISSED: Final = "dismissed"
REPORT_STATUSES = (REPORT_PENDING, REPORT_RESOLVED, REPORT_DISMISSED)


SUBMISSION_PENDING: Final = "pending"
SUBMISSION_APPROVED: Final = "approved"
SUBMISSION_REJECTED: Final = "rejected"
