"""Recommendation orchestrator: blends strategies, applies MMR, returns results.

Two modes:
- get_recommendations(): live endpoint, reads pre-computed results from user_recommendations
  and applies real-time filters (already actioned, past events, etc.). It never
  computes or fills recommendations live.
- compute_and_store(): offline nightly job, runs the full CF pipeline and writes results.
"""

import logging
import threading
from collections.abc import Iterator
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import batched, groupby
from typing import Any, Callable

from core.database import get_sb
from core.pagination import iter_all_pages
from core.tables import EVENT_DATES, USER_INTERACTIONS, USER_RECOMMENDATIONS, USERS
from recommender.collaborative import (
    CollaborativeModel,
    build_collaborative_model,
    get_collaborative_scores,
)
from recommender.config import (
    CANDIDATE_POOL_SIZE,
    DEFAULT_LAMBDA,
    DEFAULT_LIMIT,
    HOT_THRESHOLD,
    WARM_THRESHOLD,
)
from recommender.content_based import get_content_scores
from recommender.interaction_scores import get_user_event_scores
from recommender.popularity import (
    PopularityModel,
    build_popularity_model,
    get_popularity_scores,
)
from recommender.reranker import mmr_rerank
from recommender.schemas import RecommendationItem
from recommender.scoring import blend_scores, select_weights
from schemas.event import EventResponse
from services import event_query, interaction_service, school_service, user_service

log = logging.getLogger(__name__)


def get_stored_recommendations_for_users(
    user_ids: list[str],
) -> dict[str, list[dict]]:
    """Load stored recommendation rows in user chunks without live fallback."""
    grouped: dict[str, list[dict]] = {user_id: [] for user_id in user_ids}
    for chunk in batched(user_ids, 500):
        rows = (
            get_sb()
            .table(USER_RECOMMENDATIONS)
            .select("user_id,event_id,rank,predicted_score,computed_at")
            .in_("user_id", list(chunk))
            .order("rank")
            .execute()
        ).data or []
        for row in rows:
            user_id = str(row["user_id"])
            if user_id in grouped:
                grouped[user_id].append(row)
    return grouped


@dataclass(frozen=True)
class RecommendationSnapshot:
    """Shared recommendation inputs for one finite nightly batch run."""

    candidates: tuple[EventResponse, ...]
    popularity_scores: dict[int, float]
    collaborative_model: CollaborativeModel | None


# Per-user locks for the upsert-then-delete sequence inside _store_user_recs.
# Two concurrent compute_and_store calls for the same user_id would otherwise
# race on the trailing `.lt(computed_at)` delete; serializing per user ensures
# call A's delete never wipes call B's freshly-written rows.
# A module-level dict of locks is fine for single-process deployments.
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
        self._collab_scorer = collab_scorer
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

    def get_recommendations(
        self, user_id: str, limit: int = DEFAULT_LIMIT
    ) -> list[RecommendationItem]:
        """
        Read only the nightly recommendation snapshot from user_recommendations.

        Real-time reads only remove newly actioned or past events. Missing,
        stale, or filtered snapshots return no recommendations until the next
        GitHub runner completes.
        """
        try:
            recs = self._fetch_precomputed_recs(user_id)
        except Exception as e:
            log.warning("Failed to fetch pre-computed recs for user %s: %s", user_id, e)
            return []

        if recs and recs.data:
            computed_at = recs.data[0].get("computed_at")
            rec_event_ids = [rec["event_id"] for rec in recs.data]

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

            # Fail closed rather than leaking past events or computing a live
            # substitute outside the nightly snapshot.
            if future_lookup_failed:
                return []

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

            return results

        return []

    @staticmethod
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

    @staticmethod
    def _format_popular_recommendations(
        candidates: list[EventResponse],
        popularity_scores: dict[int, float],
        limit: int,
        reason: str = "Popular on campus",
    ) -> list[RecommendationItem]:
        candidates.sort(key=lambda event: popularity_scores.get(event.id, 0), reverse=True)
        return [
            RecommendationItem(
                event_id=e.id,
                score=round(popularity_scores.get(e.id, 0.0), 4),
                reason=reason,
            )
            for e in candidates[:limit]
        ]

    def compute_and_store(
        self,
        user_id: str,
        limit: int = DEFAULT_LIMIT,
        lambda_param: float | None = None,
        *,
        snapshot: RecommendationSnapshot,
    ) -> list[RecommendationItem]:
        """Run full recommendation pipeline and store results in user_recommendations."""
        lp = lambda_param if lambda_param is not None else self.default_lambda
        results = self._compute_from_snapshot(user_id, snapshot, limit, lp)

        now = datetime.now(timezone.utc).isoformat()
        rows: list[dict] = []
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
            (
                get_sb()
                .table(USER_RECOMMENDATIONS)
                .delete()
                .eq("user_id", user_id)
                .lt("computed_at", computed_at)
                .execute()
            )

    def build_snapshot(
        self,
        school: str,
        collaborative_model: CollaborativeModel | None,
        popularity_model: PopularityModel,
    ) -> RecommendationSnapshot:
        """Load one school's candidate and popularity inputs for a nightly batch."""
        candidates = tuple(self._load_candidate_events(school))
        foreign_event_ids = [event.id for event in candidates if (event.school or "") != school]
        if foreign_event_ids:
            raise RuntimeError(
                f"School candidate query for {school!r} returned foreign events "
                f"{foreign_event_ids[:10]}"
            )
        if not candidates:
            return RecommendationSnapshot(
                candidates=(),
                popularity_scores={},
                collaborative_model=collaborative_model,
            )

        candidate_ids = [event.id for event in candidates]
        return RecommendationSnapshot(
            candidates=candidates,
            popularity_scores=self._popularity_scorer(
                candidate_ids,
                model=popularity_model,
            ),
            collaborative_model=collaborative_model,
        )

    @staticmethod
    def build_shared_collaborative_model() -> CollaborativeModel:
        """Build the immutable collaborative signal reused by every school."""
        return build_collaborative_model()

    @staticmethod
    def build_shared_popularity_model() -> PopularityModel:
        """Build the immutable popularity signal reused by every school."""
        return build_popularity_model()

    def _compute_from_snapshot(
        self,
        user_id: str,
        snapshot: RecommendationSnapshot,
        limit: int = DEFAULT_LIMIT,
        lambda_param: float | None = None,
    ) -> list[RecommendationItem]:
        """Score one user against the immutable inputs for this batch."""
        lp = lambda_param if lambda_param is not None else self.default_lambda
        candidates = list(snapshot.candidates)
        if not candidates:
            return []

        candidate_ids = [e.id for e in candidates]
        events_by_id = {e.id: e for e in candidates}

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
        pop_scores = snapshot.popularity_scores

        with self.make_executor(max_workers=3) as pool:
            futures: dict[str, Any] = {}

            if has_profile:
                futures["content"] = pool.submit(
                    self._content_scorer,
                    candidates,
                    user=user,
                    user_scores=user_scores,
                )

            if (
                interaction_count >= self.warm_threshold
                and snapshot.collaborative_model is not None
            ):
                if self._collab_scorer is not None:
                    futures["collab"] = pool.submit(
                        self._collab_scorer,
                        user_id,
                        candidate_ids,
                    )
                else:
                    futures["collab"] = pool.submit(
                        get_collaborative_scores,
                        user_id,
                        candidate_ids,
                        model=snapshot.collaborative_model,
                    )

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
            # Reuse the batch snapshot rather than issuing live fallback queries
            # once per cold-start user.
            log.warning(
                "Blend empty for user %s (candidates=%d); falling back to popular recs",
                user_id,
                len(candidate_ids),
            )
            return self._format_popular_recommendations(
                candidates,
                snapshot.popularity_scores,
                limit,
            )

        # Explicit tie-break by event_id so ordering is reproducible when
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
    def _load_candidate_events(school: str) -> list[EventResponse]:
        """Load future events for one school as recommendation candidates.

        The query/dedup/hydrate is the shared ``event_query.load_upcoming_events``
        and is capped at the configured per-school pool size.
        """
        return event_query.load_upcoming_events(
            since=datetime.now(timezone.utc),
            school=school,
            cap=CANDIDATE_POOL_SIZE,
            model=EventResponse,
        )

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
    """Batch orchestration: processes users school-by-school in parallel.

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
        """Run compute_and_store for every user, grouped by school.

        Each school loads one candidate/popularity snapshot and reuses it for
        all users in that school. The collaborative model is global and
        immutable, so it is built once and shared across school snapshots.

        Users are streamed in ``school,id`` order and each school is drained
        before the next begins, bounding memory to one school snapshot plus
        the in-flight worker pool.
        """
        processed = 0
        failed = 0
        failed_ids: list[str] = []

        # Keep at most `in_flight_cap` futures pending: larger than max_workers
        # so the pool always has work, small enough to avoid materialising all
        # futures upfront.
        in_flight_cap = max(max_workers * 4, max_workers + 2)

        log.info(
            "Starting recommendation batch (max_workers=%d, in_flight_cap=%d)",
            max_workers,
            in_flight_cap,
        )

        user_iter: Iterator[dict] = self._iter_all_users()
        collaborative_model: CollaborativeModel | None = None
        collaborative_model_built = False
        popularity_model: PopularityModel | None = None

        with self._engine.make_executor(max_workers=max_workers) as pool:

            def _drain_one(future_to_uid: dict) -> None:
                nonlocal processed, failed
                done_iter = as_completed(future_to_uid)
                done_future = next(done_iter)
                finished = [done_future]
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

            for school, school_users in groupby(user_iter, key=self._user_school):
                if school is None:
                    snapshot = RecommendationSnapshot(
                        candidates=(),
                        popularity_scores={},
                        collaborative_model=None,
                    )
                    log.warning("Users without a school will have stored recommendations cleared")
                else:
                    if not collaborative_model_built:
                        collaborative_model = self._engine.build_shared_collaborative_model()
                        popularity_model = self._engine.build_shared_popularity_model()
                        collaborative_model_built = True
                    assert popularity_model is not None
                    snapshot = self._engine.build_snapshot(
                        school,
                        collaborative_model,
                        popularity_model,
                    )
                    log.info(
                        "School recommendation snapshot: school=%s candidates=%d",
                        school,
                        len(snapshot.candidates),
                    )

                future_to_uid: dict = {}
                for user in school_users:
                    if len(future_to_uid) >= in_flight_cap:
                        _drain_one(future_to_uid)
                    fut = pool.submit(
                        self._engine.compute_and_store,
                        user["id"],
                        limit,
                        lambda_param,
                        snapshot=snapshot,
                    )
                    future_to_uid[fut] = user["id"]

                while future_to_uid:
                    _drain_one(future_to_uid)

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
    def _iter_all_users() -> Iterator[dict]:
        """Yield users in school groups while keeping pagination deterministic.

        Uses the existing `iter_all_pages` streaming helper from core.pagination
        so we never materialise the full user table at once.
        """
        rows = iter_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(USERS)
                    .select(f"id,school_id,{school_service.SCHOOL_SLUG_EMBED}")
                    .order("school_id")
                    .order("id")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )
        return (school_service.with_school_slug(row) for row in rows)

    @staticmethod
    def _user_school(user: dict) -> str | None:
        school = user.get("school")
        if school is None:
            return None
        normalized = str(school).strip()
        return normalized or None


batch_runner = BatchRecommendationRunner()
