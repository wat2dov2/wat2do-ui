"""Shared status constants for user-facing tables."""

from typing import Final

REPORT_PENDING: Final = "pending"
REPORT_RESOLVED: Final = "resolved"
REPORT_DISMISSED: Final = "dismissed"
REPORT_STATUSES = (REPORT_PENDING, REPORT_RESOLVED, REPORT_DISMISSED)


SUBMISSION_PENDING: Final = "pending"
SUBMISSION_APPROVED: Final = "approved"
SUBMISSION_REJECTED: Final = "rejected"


INSTAGRAM_BATCH_GENERATING: Final = "generating"
INSTAGRAM_BATCH_READY_FOR_REVIEW: Final = "ready_for_review"
INSTAGRAM_BATCH_PUBLISHING: Final = "publishing"
INSTAGRAM_BATCH_PUBLISHED: Final = "published"
INSTAGRAM_BATCH_EMPTY: Final = "empty"
INSTAGRAM_BATCH_FAILED: Final = "failed"
INSTAGRAM_BATCH_STATUSES = (
    INSTAGRAM_BATCH_GENERATING,
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
    INSTAGRAM_BATCH_PUBLISHING,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_EMPTY,
    INSTAGRAM_BATCH_FAILED,
)

# A published carousel waits for the emulator to add a song, then records how it went.
INSTAGRAM_MUSIC_PENDING: Final = "pending"
INSTAGRAM_MUSIC_ADDED: Final = "added"
INSTAGRAM_MUSIC_FAILED: Final = "failed"

# An account a school account might follow: an admin approves or rejects it, and the
# daily follow job marks approved ones followed.
FOLLOW_CANDIDATE_PENDING: Final = "pending"
FOLLOW_CANDIDATE_APPROVED: Final = "approved"
FOLLOW_CANDIDATE_REJECTED: Final = "rejected"
FOLLOW_CANDIDATE_FOLLOWED: Final = "followed"
FOLLOW_CANDIDATE_STATUSES = (
    FOLLOW_CANDIDATE_PENDING,
    FOLLOW_CANDIDATE_APPROVED,
    FOLLOW_CANDIDATE_REJECTED,
    FOLLOW_CANDIDATE_FOLLOWED,
)
# Where a request to follow came from.
FOLLOW_SOURCE_CRAWL: Final = "crawl"
FOLLOW_SOURCE_CLUB: Final = "club"
FOLLOW_SOURCE_IMPORT: Final = "import"
