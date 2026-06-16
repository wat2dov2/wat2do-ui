"""Shared pagination defaults and bounds."""

DEFAULT_LIST_LIMIT = 100000
MAX_LIST_LIMIT = 100000

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100

# Combined with MAX_PAGE_SIZE, this caps worst-case OFFSET near 100k rows.
MAX_PAGE_NUMBER = 1_000
