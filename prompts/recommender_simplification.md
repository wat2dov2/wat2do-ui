# Recommender Simplification Prompt

This document contains the prompt to simplify the recommender system, moving it from a bloated collaborative/content-based pre-computed matrix pipeline to a lightweight, live-scoring heuristic engine.

---

## The Prompt

```markdown
Role: Codebase Refactorer
Task: Simplify the Recommender system. Remove all offline caching, collaborative filtering matrix math, and cron job code. Consolidate everything into a single-file, live-calculated scoring pipeline.

Follow these instructions strictly:

1. DELETE these files:
   - backend/recommender/collaborative.py
   - backend/recommender/content_based.py
   - backend/recommender/popularity.py
   - backend/recommender/reranker.py
   - backend/recommender/scoring.py
   - backend/recommender/evaluation.py
   - backend/recommender/job.py
   - backend/recommender/utils.py
   - backend/scripts/run_evaluation.py

2. REFACTOR backend/recommender/service.py to contain a single `RecommendationService` class:
   - Do NOT pre-compute or write to the database. Everything must be computed live on request.
   - Fetch future events (candidates) and their interaction metrics directly from the DB.
   - Implement a simple heuristic scoring function:
     - School Match: Priority boost if event.school == user.school.
     - Interest Match: Boost per matching category in user.interests.
     - Popularity Boost: Logarithmic scaling based on saving/clicking interaction counts.
     - Urgency Boost: Prioritize events starting soon; penalize events that have already started.
   - Filter out events the user has already saved (no point in recommending what they already bookmarked).
   - Apply simple diversity: Group by organization and allow max 2 events per club in the output.

3. UPDATE backend/recommender/router.py:
   - Directly call `recommendation_service.get_recommendations(user_id, limit)` to get recommendations on-the-fly.
   - Keep the fallback to popular events (using the same scoring logic with a null user) if the user is anonymous.

4. CLEAN UP database migrations:
   - Keep the tables intact, but we no longer need to write to the `user_recommendations` table (which can be deprecated/ignored).

5. WRITE unit tests in backend/recommender/test_recommendations.py:
   - Verify that the live scoring function ranks school matches higher, interest matches higher, and respects the max-2-per-club diversity limit.

Run pytest, ruff check, and mypy to ensure everything passes before completing.
```
