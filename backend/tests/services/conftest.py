"""Fixtures for service-layer tests.

Router tests go through FastAPI's TestClient with auth overrides, which
verifies HTTP contracts but never touches the Supabase query chain.
That's a real gap: a filter typo (``.eq("user_id", …)`` vs
``.eq("owner_id", …)``) passes every router test and only surfaces in
production, where it either leaks another user's rows or hides the
caller's own.

The ``fake_sb`` fixture below is a Supabase-py query-builder stand-in
that records every chain call so tests can assert on them cheaply.
Pair it with ``patch_sb("services.<resource>_service")`` to install
the fake in place of the real client for one test.

See ``.claude/rules/backend-architecture.md`` → Testing for the policy.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

# Every supabase-py builder method that currently appears somewhere in
# ``backend/services/``. If a new method shows up in a service, add it
# here — the fake needs to return ``self`` from it for chaining.
_BUILDER_METHODS = (
    # terminal actions
    "table",
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "rpc",
    # filters
    "eq",
    "neq",
    "in_",
    "gt",
    "gte",
    "lt",
    "lte",
    "like",
    "ilike",
    "is_",
    "contains",
    "not_",
    "or_",
    # ordering / windowing
    "order",
    "range",
    "limit",
    "single",
    "maybe_single",
)


class FakeSupabase:
    """Supabase-py query-builder fake.

    The real client chains fluent calls:

        sb.table("saved").select("*").eq("user_id", x).execute()

    Each intermediate method on this fake is a ``MagicMock`` that returns
    ``self``, so the chain stays on one object. Tests assert on builder
    calls via the same object (``fake_sb.eq.assert_any_call(...)``) — no
    walking of ``.return_value.return_value`` chains, and no silent
    success when the chain drifts (e.g. a stray ``.return_value`` being
    treated as a terminal that matches anything).

    Configure the response returned by the terminal ``.execute()`` via
    ``set_response(data=..., count=...)``.
    """

    def __init__(self) -> None:
        for name in _BUILDER_METHODS:
            # Each builder method returns self so chained calls land on
            # this same instance — critical for the "assert on the chain"
            # pattern below.
            setattr(self, name, MagicMock(return_value=self, name=name))

        self._response = MagicMock(data=[], count=0)
        self.execute = MagicMock(side_effect=lambda: self._response, name="execute")
        # Supabase exposes ``not_`` as a nested filter builder (``.not_.is_(...)``).
        # Point it at this instance so chained calls still reach ``execute()``.
        self.not_ = self
        # Supabase exposes ``not_`` as a nested filter builder (``.not_.is_(...)``).
        # Point it at this instance so chained calls still reach ``execute()``.
        self.not_ = self

    def set_response(self, *, data: list | None = None, count: int | None = None) -> None:
        """Configure what every ``.execute()`` call returns.

        ``data`` is the row list; ``count`` is the optional ``count="exact"``
        result. Both default to empty — call this when a test needs rows
        back from the query.
        """
        self._response = MagicMock(
            data=[] if data is None else data,
            count=0 if count is None else count,
        )
        self.execute.side_effect = lambda: self._response

    def queue_responses(self, responses: list[dict | list | None]) -> None:
        """Configure a sequence of ``.execute()`` results for multi-query tests.

        Each item is the ``data`` payload for one call, in order. Use when
        a single service function makes multiple Supabase calls (e.g. a
        fanout that fetches an event, then its saves, then the users).
        Exhausting the queue falls back to an empty response so tests
        don't crash if a new query is added mid-refactor — the failing
        assertion will still localise the regression.
        """
        queue = list(responses)

        def _next():
            if queue:
                item = queue.pop(0)
                return MagicMock(data=item if item is not None else [], count=0)
            return MagicMock(data=[], count=0)

        self.execute.side_effect = _next

    def raise_on_execute(self, exc: Exception) -> None:
        """Make the next ``.execute()`` call raise ``exc``.

        Useful for simulating unique-violation / transient errors.
        """
        self.execute.side_effect = exc


@pytest.fixture
def fake_sb() -> FakeSupabase:
    """Fresh ``FakeSupabase`` per test."""
    return FakeSupabase()


@pytest.fixture
def patch_sb(monkeypatch, fake_sb):
    """Install ``fake_sb`` in place of ``get_sb`` inside a service module.

    Each service module does ``from core.database import get_sb`` which
    copies the attribute onto the module, so patching at the source is
    not enough — we patch the copy. Call with the module path of the
    service under test:

        def test_unsave_event(fake_sb, patch_sb):
            patch_sb("services.saved_event_service")
            ...
    """

    def _patch(module_path: str) -> None:
        monkeypatch.setattr(f"{module_path}.get_sb", lambda: fake_sb)

    return _patch
