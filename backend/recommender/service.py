"""Recommendation orchestrator: blends strategies, applies MMR, returns results.

Two modes:
- get_recommendations(): live endpoint, reads pre-computed results from user_recommendations
  and applies real-time filters (already actioned, past events, etc.)
- compute_and_store(): offline nightly job, runs the full CF pipeline and writes results.
"""

import logging
import threading
from collections.abc import Iterator
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

from core.cache import TTLCache
from core.database import get_sb
from core.pagination import iter_all_pages
from core.retry import supabase_retry
from core.tables import EVENT_DATES, USER_INTERACTIONS, USER_RECOMMENDATIONS, USERS
from recommender.collaborative import get_collaborative_scores
from recommender.config import (
    CANDIDATE_EVENTS_CACHE_TTL,
    CANDIDATE_POOL_SIZE,
    DEFAULT_LAMBDA,
    DEFAULT_LIMIT,
    HOT_THRESHOLD,
    WARM_THRESHOLD,
)
from recommender.content_based import get_content_scores
from recommender.interaction_scores import get_user_event_scores
from recommender.popularity import get_popularity_scores
from recommender.reranker import mmr_rerank
from recommender.schemas import RecommendationItem
from recommender.scoring import blend_scores, select_weights
from schemas.event import EventResponse
from schemas.event_date import OccurrenceResponse
from services import event_date_service, interaction_service, user_service
from services.ab_test_service import ab_test

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Short-lived TTL cache for candidate events (future events query).
# Identical for all users within a time window — avoids redundant DB hits
# during nightly batch processing (compute_all_users) and concurrent live
# requests.
# ---------------------------------------------------------------------------
_candidates_cache = TTLCache(default_ttl=CANDIDATE_EVENTS_CACHE_TTL)


def invalidate_candidates_cache() -> None:
    """Invalidate the shared candidate-events cache.

    Callers (event_service create/update/delete paths) should invoke this so
    that newly-published or mutated events show up in recommendations before
    the TTL expires.
    """
    _candidates_cache.clear()


# ---------------------------------------------------------------------------
# Per-user locks for the upsert-then-delete sequence inside _store_user_recs.
# Two concurrent compute_and_store calls for the same user_id would otherwise
# race on the trailing `.lt(computed_at)` delete; serializing per user ensures
# call A's delete never wipes call B's freshly-written rows.
# A module-level dict of locks is fine for single-process deployments.
# ---------------------------------------------------------------------------
_store_locks_guard = threading.Lock()
_store_locks: dict[str, threading.Lock] = {}


def _get_store_lock(user_id: str) -> threading.Lock:
    with _store_locks_guard:
        lock = _store_locks.get(user_id)
        if lock is None:
            lock = threading.Lock()
            _store_locks[user_id] = lock
        return lock


class RecommendationEngine:
    def __init__(
        self,
        *,
        content_scorer=None,
        collab_scorer=None,
        popularity_scorer=None,
        reranker=None,
        executor_factory: Callable[..., Executor] | None = None,
        hot_threshold: int = HOT_THRESHOLD,
        warm_threshold: int = WARM_THRESHOLD,
        default_lambda: float = DEFAULT_LAMBDA,
    ):
        self._content_scorer = content_scorer or get_content_scores
        self._collab_scorer = collab_scorer or get_collaborative_scores
        self._popularity_scorer = popularity_scorer or get_popularity_scores
        self._reranker = reranker or mmr_rerank
        self._executor_factory = executor_factory or (
            lambda max_workers: ThreadPoolExecutor(max_workers=max_workers)
        )
        self.hot_threshold = hot_threshold
        self.warm_threshold = warm_threshold
        self.default_lambda = default_lambda

    def make_executor(self, max_workers: int = 2) -> Executor:
        """Create an executor using the injected factory."""
        return self._executor_factory(max_workers=max_workers)

    # ---------------------------------------------------------------------------
    # Online: thin serving layer — reads pre-computed recs, applies real-time filters
    # ---------------------------------------------------------------------------

    def get_recommendations(
        self, user_id: str, limit: int = DEFAULT_LIMIT
    ) -> list[RecommendationItem]:
        """
        Read pre-computed recs from user_recommendations.
        Apply real-time filters: strip events the user has interacted with since
        the last compute, past events, etc.
        Falls back to live computation if no pre-computed recs exist.
        """
        try:
            recs = self._fetch_precomputed_recs(user_id)
        except Exception as e:
            log.warning("Failed to fetch pre-computed recs for user %s: %s", user_id, e)
            recs = None

        if recs and recs.data:
            computed_at = recs.data[0].get("computed_at")
            rec_event_ids = [rec["event_id"] for rec in recs.data]

            # Parallelize the two independent filter queries:
            # 1. Recently actioned events (to exclude)
            # 2. Which of these rec'd event IDs are still in the future (filtered lookup
            #    instead of scanning all future events)
            exclude: set[int] = set()
            future_ids: set[int] | None = None
            future_lookup_failed = False
            now = datetime.now(timezone.utc).isoformat()

            with self.make_executor(max_workers=2) as pool:
                actions_future = pool.submit(self._fetch_recent_actions, user_id, computed_at)
                future_future = pool.submit(self._fetch_future_event_ids, rec_event_ids, now)

                try:
                    exclude = actions_future.result()
                except Exception as e:
                    log.warning("Failed to fetch recent interactions for user %s: %s", user_id, e)

                try:
                    future_ids = future_future.result()
                except Exception as e:
                    log.warning("Failed to check future events: %s", e)
                    future_lookup_failed = True

            # Fail closed: if we couldn't verify which pre-computed events are
            # still in the future, fall through to live computation rather than
            # leak past events.
            if future_lookup_failed:
                return self._compute_live(user_id, limit)

            results: list[RecommendationItem] = []
            for rec in recs.data:
                eid = rec["event_id"]
                if eid in exclude:
                    continue
                if future_ids is not None and eid not in future_ids:
                    continue
                results.append(
                    RecommendationItem(
                        event_id=eid,
                        score=round(rec["predicted_score"], 4),
                        reason=rec.get("reason") or "Recommended for you",
                    )
                )
                if len(results) >= limit:
                    break

            # R17: top up with live compute when pre-computed filtering left
            # fewer than `limit` results. Dedup by event_id so we don't emit
            # an event twice.
            if results and len(results) < limit:
                seen = {r.event_id for r in results}
                try:
                    topup = self._compute_live(user_id, limit)
                except Exception as e:
                    log.warning("Live top-up failed for user %s: %s", user_id, e)
                    topup = []
                for item in topup:
                    if item.event_id in seen:
                        continue
                    results.append(item)
                    seen.add(item.event_id)
                    if len(results) >= limit:
                        break
                return results

            if results:
                return results

        return self._compute_live(user_id, limit)

    @staticmethod
    @supabase_retry
    def _fetch_precomputed_recs(user_id: str):
        return (
            get_sb()
            .table(USER_RECOMMENDATIONS)
            .select("event_id, rank, predicted_score, reason, computed_at")
            .eq("user_id", user_id)
            .order("rank")
            .execute()
        )

    @staticmethod
    @supabase_retry
    def _fetch_recent_actions(user_id: str, since: str) -> set[int]:
        """Fetch event IDs the user interacted with after a given timestamp."""
        r = (
            get_sb()
            .table(USER_INTERACTIONS)
            .select("event_id")
            .eq("user_id", user_id)
            .gt("created_at", since)
            .execute()
        )
        return {row["event_id"] for row in (r.data or [])}

    @staticmethod
    @supabase_retry
    def _fetch_future_event_ids(event_ids: list[int], now: str) -> set[int]:
        """Check which of the given event IDs have at least one future occurrence.

        Multi-occurrence events show up multiple times in event_dates;
        the ``set()`` collapses them back to logical event ids.
        """
        r = (
            get_sb()
            .table(EVENT_DATES)
            .select("event_id")
            .in_("event_id", event_ids)
            .gte("dtstart_utc", now)
            .execute()
        )
        return {e["event_id"] for e in (r.data or [])}

    def get_popular_recommendations(self, limit: int = DEFAULT_LIMIT) -> list[RecommendationItem]:
        """Return popular upcoming events for anonymous or cold-start users."""
        try:
            candidates = self._get_candidate_events()
        except Exception:
            log.warning("Failed to load popular recommendation candidates", exc_info=True)
            return []
        if not candidates:
            return []

        pop_scores: dict[int, float] = {}
        try:
            pop_scores = self._popularity_scorer([e.id for e in candidates])
            candidates.sort(key=lambda e: pop_scores.get(e.id, 0), reverse=True)
            reason = "Popular on campus"
        except Exception as e:
            log.warning("Popularity scoring failed, falling back to recency: %s", e)
            reason = "Happening soon"

        # R20: emit the real popularity score so downstream analytics (AB test
        # metrics, CTR) can rank/compare rather than seeing a uniform 0.0.
        return [
            RecommendationItem(
                event_id=e.id,
                score=round(pop_scores.get(e.id, 0.0), 4),
                reason=reason,
            )
            for e in candidates[:limit]
        ]

    def get_personalized_recommendations(
        self,
        user_id: str,
        limit: int = DEFAULT_LIMIT,
    ) -> list[RecommendationItem]:
        """Full personalized flow: get recs, resolve AB variant, record impressions.

        Orchestrates the AB test integration so routers make a single call.
        Falls back to popular recommendations on failure.
        """
        variant = ab_test.get_user_variant(user_id)
        try:
            recs = self.get_recommendations(user_id=user_id, limit=limit)
        except Exception:
            log.warning(
                "Personalized recommendations failed for user %s; falling back to popular",
                user_id,
                exc_info=True,
            )
            recs = self.get_popular_recommendations(limit=limit)
        try:
            ab_test.record_impressions(user_id, [r.event_id for r in recs], variant)
        except Exception:
            log.warning("Failed to record AB impressions for user %s", user_id, exc_info=True)
        return recs

    # ---------------------------------------------------------------------------
    # Offline: full pipeline — runs nightly, writes to user_recommendations
    # ---------------------------------------------------------------------------

    def compute_and_store(
        self,
        user_id: str,
        limit: int = DEFAULT_LIMIT,
        lambda_param: float | None = None,
    ) -> list[RecommendationItem]:
        """Run full recommendation pipeline and store results in user_recommendations."""
        lp = lambda_param if lambda_param is not None else self.default_lambda
        results = self._compute_live(user_id, limit, lp)
        if not results:
            return []

        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for i, rec in enumerate(results):
            rows.append(
                {
                    "user_id": user_id,
                    "event_id": rec.event_id,
                    "rank": i + 1,
                    "predicted_score": rec.score,
                    "reason": rec.reason,
                    "computed_at": now,
                }
            )

        try:
            self._store_user_recs(user_id, rows)
        except Exception as e:
            log.warning("Failed to store recommendations: %s", e)

        return results

    @supabase_retry
    def _store_user_recs(self, user_id: str, rows: list[dict]) -> None:
        """Upsert new recs then remove stale entries, so a failed insert never
        wipes existing recommendations.

        Serialized per-user so two overlapping compute_and_store calls for the
        same user can't race on the trailing delete (where call A's delete
        could otherwise erase rows call B just upserted).
        """
        with _get_store_lock(user_id):
            if not rows:
                get_sb().table(USER_RECOMMENDATIONS).delete().eq("user_id", user_id).execute()
                return
            computed_at = rows[0]["computed_at"]
            get_sb().table(USER_RECOMMENDATIONS).upsert(
                rows, on_conflict="user_id,event_id"
            ).execute()
            # Remove stale rows from previous computes
            (
                get_sb()
                .table(USER_RECOMMENDATIONS)
                .delete()
                .eq("user_id", user_id)
                .lt("computed_at", computed_at)
                .execute()
            )

    # ---------------------------------------------------------------------------
    # Core pipeline (shared by live and offline)
    # ---------------------------------------------------------------------------

    def _compute_live(
        self,
        user_id: str,
        limit: int = DEFAULT_LIMIT,
        lambda_param: float | None = None,
    ) -> list[RecommendationItem]:
        """Full recommendation pipeline: score, blend, re-rank."""
        lp = lambda_param if lambda_param is not None else self.default_lambda
        candidates = self._get_candidate_events()
        if not candidates:
            return []

        candidate_ids = [e.id for e in candidates]
        events_by_id = {e.id: e for e in candidates}

        # Parallelize independent DB lookups: user profile, interaction count,
        # and per-user interaction scores (needed by content-based scorer).
        user = None
        interaction_count = 0
        user_scores: dict[int, float] = {}
        with self.make_executor(max_workers=3) as pool:
            user_future = pool.submit(user_service.get_user, user_id)
            count_future = pool.submit(interaction_service.get_user_interaction_count, user_id)
            scores_future = pool.submit(get_user_event_scores, user_id)

            try:
                user = user_future.result()
            except Exception as e:
                log.warning(
                    "Failed to fetch user profile for %s, degrading to cold-start: %s", user_id, e
                )

            try:
                interaction_count = count_future.result()
            except Exception as e:
                log.warning("Failed to get interaction count for user %s: %s", user_id, e)

            try:
                user_scores = scores_future.result()
            except Exception as e:
                log.warning("Failed to get user event scores for user %s: %s", user_id, e)

        has_profile = bool(user and user.interests)

        content_scores: dict[int, float] = {}
        collab_scores: dict[int, float] = {}
        pop_scores: dict[int, float] = {}

        # Parallelize scoring strategies: popularity always runs; content and
        # collaborative run conditionally but are independent of each other.
        with self.make_executor(max_workers=3) as pool:
            futures: dict[str, Any] = {}
            futures["pop"] = pool.submit(self._popularity_scorer, candidate_ids)

            if has_profile:
                futures["content"] = pool.submit(
                    self._content_scorer,
                    user_id,
                    candidates,
                    user=user,
                    user_scores=user_scores,
                )

            if interaction_count >= self.warm_threshold:
                futures["collab"] = pool.submit(self._collab_scorer, user_id, candidate_ids)

            try:
                pop_scores = futures["pop"].result()
            except Exception as e:
                log.warning("Popularity scoring failed for live recs: %s", e)

            if "content" in futures:
                try:
                    content_scores = futures["content"].result()
                except Exception as e:
                    log.warning("Content scoring failed for user %s: %s", user_id, e)

            if "collab" in futures:
                try:
                    collab_scores = futures["collab"].result()
                except Exception as e:
                    log.warning("Collaborative scoring failed for user %s: %s", user_id, e)

        weights = select_weights(
            interaction_count,
            has_profile,
            hot_threshold=self.hot_threshold,
            warm_threshold=self.warm_threshold,
        )
        blended = blend_scores(
            candidate_ids,
            content_scores,
            collab_scores,
            pop_scores,
            weights,
        )

        if not blended:
            # R8/R22: fall through to popular recommendations rather than
            # returning dtstart-sorted candidates with score=0.0.
            log.warning(
                "Blend empty for user %s (candidates=%d); falling back to popular recs",
                user_id,
                len(candidate_ids),
            )
            return self.get_popular_recommendations(limit)

        # R18: explicit tie-break by event_id so ordering is reproducible when
        # two events end up with identical blended scores.
        scored_list = sorted(blended.items(), key=lambda x: (-x[1], x[0]))
        reranked_ids = self._reranker(
            scored_events=scored_list,
            events_metadata=events_by_id,
            lambda_param=lp,
            k=limit,
        )

        results = []
        for eid in reranked_ids:
            reason = self._generate_reason(
                eid, content_scores, collab_scores, pop_scores, events_by_id, weights
            )
            results.append(
                RecommendationItem(
                    event_id=eid,
                    score=round(blended.get(eid, 0), 4),
                    reason=reason,
                )
            )

        return results

    @staticmethod
    def _get_candidate_events() -> list[EventResponse]:
        """Load future events as recommendation candidates.

        Cached for CANDIDATE_EVENTS_CACHE_TTL seconds so concurrent
        recommendation requests (and nightly batch runs) share one DB
        round-trip.  The TTL is kept short (60s) to avoid serving stale
        event data to live users.
        """

        @supabase_retry
        def _fetch_candidates() -> list[EventResponse]:
            log.debug("Candidate events cache MISS — querying DB")
            now = datetime.now(timezone.utc).isoformat()
            r = (
                get_sb()
                .table(EVENT_DATES)
                .select("event_id,dtstart_utc,dtend_utc,events!inner(*)")
                .gte("dtstart_utc", now)
                .order("dtstart_utc", desc=False)
                .limit(CANDIDATE_POOL_SIZE * 4)
                .execute()
            )
            primary_by_event: dict[int, dict] = {}
            event_rows: dict[int, dict] = {}
            event_ids: list[int] = []
            seen: set[int] = set()
            for row in r.data or []:
                eid = row.get("event_id")
                if eid is None:
                    continue
                event_row = row.get("events")
                if not event_row:
                    continue
                if eid in seen:
                    continue
                seen.add(eid)
                primary_by_event[eid] = row
                event_rows[eid] = event_row
                event_ids.append(eid)
                if len(event_ids) >= CANDIDATE_POOL_SIZE:
                    break

            if not event_ids:
                return []

            occ_by_event = event_date_service.list_for_events(event_ids)
            candidates: list[EventResponse] = []
            for eid in event_ids:
                row = event_rows.get(eid)
                primary = primary_by_event.get(eid)
                if not row or not primary:
                    continue
                payload = dict(row)
                occurrences = occ_by_event.get(eid, [])
                payload["occurrences"] = [
                    occ.model_dump(mode="json")
                    for occ in occurrences
                    if isinstance(occ, OccurrenceResponse)
                ]
                payload["dtstart_utc"] = primary.get("dtstart_utc")
                payload["dtend_utc"] = primary.get("dtend_utc")
                candidates.append(EventResponse.model_validate(payload))
            return candidates

        return _candidates_cache.get_or_compute("candidates", _fetch_candidates)

    @staticmethod
    def _generate_reason(
        eid: int,
        content_scores: dict[int, float],
        collab_scores: dict[int, float],
        pop_scores: dict[int, float],
        events_by_id: dict[int, EventResponse],
        weights: tuple[float, float, float],
    ) -> str:
        """Generate a human-readable reason for the recommendation."""
        c_score = content_scores.get(eid, 0) * weights[0]
        cf_score = collab_scores.get(eid, 0) * weights[1]
        p_score = pop_scores.get(eid, 0) * weights[2]

        event = events_by_id.get(eid)
        category = event.category if event else ""

        if cf_score >= c_score and cf_score >= p_score and cf_score > 0:
            return "Similar to events you've enjoyed"
        elif c_score >= p_score and c_score > 0:
            if category:
                return f"Matches your interest in {category}"
            return "Based on your profile"
        elif p_score > 0:
            return "Popular on campus"
        return "Recommended for you"


engine = RecommendationEngine()


class BatchRecommendationRunner:
    """Batch orchestration: runs compute_and_store for all users in parallel.

    Separated from RecommendationEngine so the engine stays focused on
    scoring/blending logic while the runner owns threading, progress
    logging, retry, and stats aggregation.
    """

    def __init__(self, rec_engine: RecommendationEngine | None = None):
        self._engine = rec_engine or engine

    def compute_all_users(
        self,
        limit: int = DEFAULT_LIMIT,
        lambda_param: float | None = None,
        max_workers: int = 6,
    ) -> dict:
        """Run compute_and_store for every user in parallel. Returns stats dict.

        Uses ThreadPoolExecutor to process users concurrently. Each user's
        computation is independent (no shared mutable state, DB writes are
        scoped by user_id). max_workers is kept moderate to respect Supabase
        API rate limits — each worker issues multiple HTTP requests per user.

        R6: streams users page-by-page from the DB and caps the number of
        in-flight futures at ``max_workers * IN_FLIGHT_MULT`` so memory is
        O(pool) rather than O(total_users).
        """
        processed = 0
        failed = 0
        failed_ids: list[str] = []

        # Producer/consumer: keep at most `in_flight_cap` futures pending.
        # Larger than max_workers so the pool always has work to pick up, but
        # small enough that we don't materialise all futures upfront.
        in_flight_cap = max(max_workers * 4, max_workers + 2)

        log.info(
            "Starting recommendation batch (max_workers=%d, in_flight_cap=%d)",
            max_workers,
            in_flight_cap,
        )

        user_iter: Iterator[dict] = self._iter_all_user_ids()

        with self._engine.make_executor(max_workers=max_workers) as pool:
            future_to_uid: dict = {}

            def _drain_one() -> None:
                nonlocal processed, failed
                # Wait for at least one future to complete, then drain every
                # future that's already done.
                done_iter = as_completed(future_to_uid)
                done_future = next(done_iter)
                finished = [done_future]
                # Also pick up any others that happen to be done already.
                for f in list(future_to_uid):
                    if f is done_future:
                        continue
                    if f.done():
                        finished.append(f)
                for f in finished:
                    uid = future_to_uid.pop(f)
                    try:
                        f.result()
                        processed += 1
                    except Exception:
                        failed += 1
                        failed_ids.append(str(uid))
                        log.warning("Failed to compute recs for user %s", uid, exc_info=True)
                    done = processed + failed
                    if done % 100 == 0:
                        log.info("Batch progress: %d done (%d failed)", done, failed)

            for user in user_iter:
                if len(future_to_uid) >= in_flight_cap:
                    _drain_one()
                fut = pool.submit(
                    self._engine.compute_and_store,
                    user["id"],
                    limit,
                    lambda_param,
                )
                future_to_uid[fut] = user["id"]

            # Drain remaining futures.
            while future_to_uid:
                _drain_one()

        total = processed + failed
        stats = {
            "total_users": total,
            "processed": processed,
            "failed": failed,
            "failed_ids": failed_ids,
        }
        log.info(
            "Recommendation batch complete: %s",
            {k: v for k, v in stats.items() if k != "failed_ids"},
        )
        return stats

    @staticmethod
    def _iter_all_user_ids() -> Iterator[dict]:
        """Yield users one page at a time to bound memory during batch runs.

        Uses the existing `iter_all_pages` streaming helper from core.pagination
        so we never materialise the full user table at once.
        """
        return iter_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(USERS)
                    .select("id")
                    .order("id")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )


batch_runner = BatchRecommendationRunner()
