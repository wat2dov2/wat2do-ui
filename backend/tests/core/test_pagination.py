"""Tests for core.pagination — fetch_all_pages caps, apply_stable_order, envelope."""

import pytest

from core.pagination import (
    PaginationOverflowError,
    apply_stable_order,
    fetch_all_pages,
    iter_all_pages,
)


class TestFetchAllPagesMaxRows:
    """P17: fetch_all_pages must respect max_rows."""

    def test_returns_full_result_under_cap(self):
        all_rows = [{"id": i} for i in range(50)]

        def query_fn(offset, page_size):
            return all_rows[offset : offset + page_size]

        result = fetch_all_pages(query_fn, page_size=10, max_rows=1000)
        assert len(result) == 50

    def test_raises_overflow_when_rows_exceed_cap(self):
        # Emit 150 rows with page_size=50; cap=100.  After two pages we have
        # 100 rows >= cap; the third page would push us over the limit so we
        # must raise.
        all_rows = [{"id": i} for i in range(150)]

        def query_fn(offset, page_size):
            return all_rows[offset : offset + page_size]

        with pytest.raises(PaginationOverflowError):
            fetch_all_pages(query_fn, page_size=50, max_rows=100)

    def test_zero_max_rows_rejected(self):
        with pytest.raises(ValueError):
            fetch_all_pages(lambda o, s: [], max_rows=0)

    def test_terminates_on_partial_page(self):
        """Helper stops once a partial page is returned — doesn't need max."""
        pages = [[{"id": 0}, {"id": 1}], [{"id": 2}]]

        def query_fn(offset, page_size):
            # Return pages in order.
            return pages[offset // page_size]

        result = fetch_all_pages(query_fn, page_size=2, max_rows=1000)
        assert [r["id"] for r in result] == [0, 1, 2]


class TestIterAllPagesMaxRows:
    """P17: iter_all_pages must respect max_rows."""

    def test_yields_under_cap(self):
        all_rows = [{"id": i} for i in range(30)]

        def query_fn(offset, page_size):
            return all_rows[offset : offset + page_size]

        ids = [r["id"] for r in iter_all_pages(query_fn, page_size=10, max_rows=1000)]
        assert ids == list(range(30))

    def test_raises_overflow_when_cap_exceeded(self):
        all_rows = [{"id": i} for i in range(150)]

        def query_fn(offset, page_size):
            return all_rows[offset : offset + page_size]

        gen = iter_all_pages(query_fn, page_size=50, max_rows=100)
        collected = []
        with pytest.raises(PaginationOverflowError):
            for row in gen:
                collected.append(row)
        # We collected up to but not beyond the cap.
        assert len(collected) == 100


class FakeQueryBuilder:
    """Mimic the chainable .order() surface of the supabase-py query builder."""

    def __init__(self):
        self.orders: list[tuple[str, bool]] = []

    def order(self, column, desc=True):
        self.orders.append((column, desc))
        return self


class TestApplyStableOrder:
    """P6/P8: apply_stable_order appends a unique tiebreaker."""

    def test_appends_id_tiebreaker(self):
        q = FakeQueryBuilder()
        apply_stable_order(q, "submitted_at")
        assert q.orders == [("submitted_at", True), ("id", True)]

    def test_honors_desc_false(self):
        q = FakeQueryBuilder()
        apply_stable_order(q, "dtstart_utc", desc=False)
        assert q.orders == [("dtstart_utc", False), ("id", False)]

    def test_custom_tiebreaker(self):
        q = FakeQueryBuilder()
        apply_stable_order(q, "name", tiebreaker="uuid")
        assert q.orders == [("name", True), ("uuid", True)]
