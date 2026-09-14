"""Tests for shared pagination limits and stable ordering."""

from math import ceil

import pytest

from core.pagination import (
    PaginationOverflowError,
    apply_stable_order,
    fetch_all_pages,
    iter_all_pages,
)


@pytest.mark.parametrize("loader", [fetch_all_pages, iter_all_pages])
@pytest.mark.parametrize("page_size", [1, 2, 5])
@pytest.mark.parametrize("row_count", [0, 1, 2, 4, 5, 8])
@pytest.mark.parametrize("max_rows", [1, 3, 5, 10])
def test_pagination_boundaries(loader, page_size, row_count, max_rows):
    rows = [{"id": index} for index in range(row_count)]
    offsets = []

    def query_fn(offset, limit):
        offsets.append(offset)
        assert limit == page_size
        return rows[offset : offset + limit]

    # A partial final page ends pagination without requesting another page.
    full_page_rows = row_count // page_size * page_size
    if full_page_rows >= max_rows:
        expected_calls = ceil(max_rows / page_size)
        with pytest.raises(PaginationOverflowError):
            list(loader(query_fn, page_size=page_size, max_rows=max_rows))
    else:
        expected_calls = row_count // page_size + 1
        assert list(loader(query_fn, page_size=page_size, max_rows=max_rows)) == rows

    assert offsets == [index * page_size for index in range(expected_calls)]


@pytest.mark.parametrize("loader", [fetch_all_pages, iter_all_pages])
@pytest.mark.parametrize("max_rows", [0, -1])
def test_pagination_rejects_nonpositive_cap(loader, max_rows):
    with pytest.raises(ValueError, match="max_rows must be positive"):
        list(loader(lambda offset, size: [], max_rows=max_rows))


@pytest.mark.parametrize("loader", [fetch_all_pages, iter_all_pages])
def test_pagination_propagates_query_errors(loader):
    offsets = []

    def query_fn(offset, page_size):
        offsets.append(offset)
        if offset:
            raise RuntimeError("storage unavailable")
        return [{"id": index} for index in range(page_size)]

    with pytest.raises(RuntimeError, match="storage unavailable"):
        list(loader(query_fn, page_size=2))
    assert offsets == [0, 2]


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
