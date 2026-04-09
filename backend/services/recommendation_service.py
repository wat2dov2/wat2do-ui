"""Recommendation orchestrator: blends strategies, applies MMR, returns results.

Two modes:
- get_recommendations(): live endpoint, reads pre-computed results from user_recommendations
  and applies real-time filters (already actioned, past events, etc.)
- compute_and_store(): offline nightly job, runs the full CF pipeline and writes results.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from postgrest.exceptions import APIError

from core.constants import supabase_retry
from core.database import get_sb
from core.tables import EVENTS, USER_INTERACTIONS, USER_RECOMMENDATIONS, USERS
from schemas.event import EventResponse
from schemas.recommendation import RecommendationItem
from services import user_service, interaction_service
from services.recommender.content_based import get_content_scores
from services.recommender.collaborative import get_collaborative_scores
from services.recommender.popularity import get_popularity_scores
from services.recommender.reranker import mmr_rerank
from services.recommender.config import (
    DEFAULT_LIMIT,
    DEFAULT_LAMBDA,
    HOT_THRESHOLD,
    WARM_THRESHOLD,
    WEIGHTS_HOT,
    WEIGHTS_WARM,
    WEIGHTS_WARM_NO_COLLAB,
    WEIGHTS_COLD,
    CANDIDATE_POOL_SIZE,
)

log = logging.getLogger(__name__)

# Page size for batched loading from PostgREST.  Supabase's default max-rows
# is 1000 — queries without an explicit limit are silently truncated there.
_LOAD_PAGE_SIZE = 1000


class RecommendationEngine:
    def __init__(
        self,
        *,
        content_scorer=None,
        collab_scorer=None,
        popularity_scorer=None,
        reranker=None,
        hot_threshold: int = HOT_THRESHOLD,
        warm_threshold: int = WARM_THRESHOLD,
        default_lambda: float = DEFAULT_LAMBDA,
    ):
        self._content_scorer = content_scorer or get_content_scores
        self._collab_scorer = collab_scorer or get_collaborative_scores
        self._popularity_scorer = popularity_scorer or get_popularity_scores
        self._reranker = reranker or mmr_rerank
        self.hot_threshold = hot_threshold
        self.warm_threshold = warm_threshold
        self.default_lambda = default_lambda

    # ---------------------------------------------------------------------------
    # Online: thin serving layer — reads pre-computed recs, applies real-time filters
    # ---------------------------------------------------------------------------

    def get_recommendations(self, user_id: str, limit: int = DEFAULT_LIMIT) -> list[RecommendationItem]:
        """
        Read pre-computed recs from user_recommendations.
        Apply real-time filters: strip events the user has interacted with since
        the last compute, past events, etc.
        Falls back to live computation if no pre-computed recs exist.
        """
        try:
            recs = (
                get_sb()
                .table(USER_RECOMMENDATIONS)
                .select("event_id, rank, predicted_score, reason, computed_at")
                .eq("user_id", user_id)
                .order("rank")
                .execute()
            )
        except APIError as e:
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
            now = datetime.now(timezone.utc).isoformat()

            with ThreadPoolExecutor(max_workers=2) as pool:
                actions_future = pool.submit(
                    self._fetch_recent_actions, user_id, computed_at
                )
                future_future = pool.submit(
                    self._fetch_future_event_ids, rec_event_ids, now
                )

                try:
                    exclude = actions_future.result()
                except APIError as e:
                    log.warning("Failed to fetch recent interactions for user %s: %s", user_id, e)

                try:
                    future_ids = future_future.result()
                except APIError as e:
                    log.warning("Failed to check future events: %s", e)

            results: list[RecommendationItem] = []
            for rec in recs.data:
                eid = rec["event_id"]
                if eid in exclude:
                    continue
                if future_ids is not None and eid not in future_ids:
                    continue
                results.append(RecommendationItem(
                    event_id=eid,
                    score=round(rec["predicted_score"], 4),
                    reason=rec.get("reason") or "Recommended for you",
                ))
                if len(results) >= limit:
                    break

            if results:
                return results

        return self._compute_live(user_id, limit)

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
        """Check which of the given event IDs are still in the future.

        Uses an IN-clause filter instead of scanning all future events,
        so the query touches only the rows we care about.
        """
        r = (
            get_sb()
            .table(EVENTS)
            .select("id")
            .in_("id", event_ids)
            .gte("dtstart_utc", now)
            .execute()
        )
        return {e["id"] for e in (r.data or [])}

    def get_popular_recommendations(self, limit: int = DEFAULT_LIMIT) -> list[RecommendationItem]:
        """Return popular upcoming events for anonymous or cold-start users."""
        candidates = self._get_candidate_events()
        if not candidates:
            return []

        try:
            pop_scores = self._popularity_scorer([e.id for e in candidates])
            candidates.sort(key=lambda e: pop_scores.get(e.id, 0), reverse=True)
            reason = "Popular on campus"
        except Exception as e:
            log.warning("Popularity scoring failed, falling back to recency: %s", e)
            reason = "Happening soon"

        return [
            RecommendationItem(event_id=e.id, score=0.0, reason=reason)
            for e in candidates[:limit]
        ]

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
            rows.append({
                "user_id": user_id,
                "event_id": rec.event_id,
                "rank": i + 1,
                "predicted_score": rec.score,
                "reason": rec.reason,
                "computed_at": now,
            })

        try:
            self._store_user_recs(user_id, rows)
        except Exception as e:
            log.warning("Failed to store recommendations: %s", e)

        return results

    @supabase_retry
    def _store_user_recs(self, user_id: str, rows: list[dict]) -> None:
        """Upsert new recs then remove stale entries, so a failed insert never
        wipes existing recommendations."""
        if not rows:
            get_sb().table(USER_RECOMMENDATIONS).delete().eq("user_id", user_id).execute()
            return
        computed_at = rows[0]["computed_at"]
        get_sb().table(USER_RECOMMENDATIONS).upsert(
            rows, on_conflict="user_id,event_id"
        ).execute()
        # Remove stale rows from previous computes
        (get_sb()
         .table(USER_RECOMMENDATIONS)
         .delete()
         .eq("user_id", user_id)
         .lt("computed_at", computed_at)
         .execute())

    def compute_all_users(self, limit: int = DEFAULT_LIMIT, lambda_param: float | None = None) -> dict:
        """Run compute_and_store for every user. Returns stats dict."""
        users = self._fetch_all_user_ids()
        processed = 0
        failed = 0
        failed_ids: list[str] = []

        for user in users:
            uid = user["id"]
            try:
                self.compute_and_store(uid, limit, lambda_param)
                processed += 1
            except Exception:
                failed += 1
                failed_ids.append(str(uid))
                log.warning("Failed to compute recs for user %s", uid, exc_info=True)

        stats = {
            "total_users": len(users),
            "processed": processed,
            "failed": failed,
            "failed_ids": failed_ids,
        }
        log.info("Recommendation batch complete: %s", {k: v for k, v in stats.items() if k != "failed_ids"})
        return stats

    @supabase_retry
    def _fetch_all_user_ids(self) -> list[dict]:
        """Fetch all user IDs, with retry on transient failures.

        Loads rows in pages of ``_LOAD_PAGE_SIZE`` to avoid silent truncation
        by PostgREST's server-side ``max-rows`` limit (default 1000 on Supabase).
        """
        rows: list[dict] = []
        offset = 0
        while True:
            page = (
                get_sb()
                .table(USERS)
                .select("id")
                .order("id")
                .range(offset, offset + _LOAD_PAGE_SIZE - 1)
                .execute()
            ).data or []
            rows.extend(page)
            if len(page) < _LOAD_PAGE_SIZE:
                break
            offset += _LOAD_PAGE_SIZE
        return rows

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

        # Parallelize independent DB lookups: user profile + interaction count
        user = None
        interaction_count = 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            user_future = pool.submit(user_service.get_user, user_id)
            count_future = pool.submit(interaction_service.get_user_interaction_count, user_id)

            user = user_future.result()
            try:
                interaction_count = count_future.result()
            except Exception as e:
                log.warning("Failed to get interaction count for user %s: %s", user_id, e)

        has_profile = bool(user and user.interests)

        content_scores: dict[int, float] = {}
        collab_scores: dict[int, float] = {}
        pop_scores: dict[int, float] = {}

        # Parallelize scoring strategies: popularity always runs; content and
        # collaborative run conditionally but are independent of each other.
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures: dict[str, object] = {}
            futures["pop"] = pool.submit(self._popularity_scorer, candidate_ids)

            if has_profile:
                futures["content"] = pool.submit(self._content_scorer, user_id, candidates)

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

        if interaction_count >= self.hot_threshold:
            weights = WEIGHTS_HOT
        elif interaction_count >= self.warm_threshold:
            weights = WEIGHTS_WARM
        elif has_profile:
            weights = WEIGHTS_WARM_NO_COLLAB
        else:
            weights = WEIGHTS_COLD

        w_content, w_collab, w_pop = weights
        blended: dict[int, float] = {}
        for eid in candidate_ids:
            score = (
                w_content * content_scores.get(eid, 0)
                + w_collab * collab_scores.get(eid, 0)
                + w_pop * pop_scores.get(eid, 0)
            )
            if score > 0:
                blended[eid] = score

        if not blended:
            return [
                RecommendationItem(event_id=e.id, score=0.0, reason="Happening soon")
                for e in candidates[:limit]
            ]

        scored_list = sorted(blended.items(), key=lambda x: x[1], reverse=True)
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
            results.append(RecommendationItem(
                event_id=eid,
                score=round(blended.get(eid, 0), 4),
                reason=reason,
            ))

        return results

    @staticmethod
    def _get_candidate_events() -> list[EventResponse]:
        """Load future events as recommendation candidates."""
        now = datetime.now(timezone.utc).isoformat()
        r = (
            get_sb()
            .table(EVENTS)
            .select("*")
            .gte("dtstart_utc", now)
            .order("dtstart_utc", desc=False)
            .limit(CANDIDATE_POOL_SIZE)
            .execute()
        )
        return [EventResponse.model_validate(row) for row in (r.data or [])]

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
