#!/usr/bin/env python3
"""
Nightly recommendation computation job.

Runs the full CF pipeline for every user and writes pre-computed results
to the user_recommendations table. Designed to be called from GitHub Actions
or manually via CLI.

Usage:
    python jobs/compute_recommendations.py
    python jobs/compute_recommendations.py --limit 30 --lambda 0.6
"""

import argparse
import sys
import os
import time

# Add backend root to path so imports work when run from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from services.recommendation_service import engine as recommendation_engine
from services.recommender.evaluation import evaluate_all_users


def main():
    parser = argparse.ArgumentParser(description="Compute recommendations for all users")
    parser.add_argument("--limit", type=int, default=20, help="Max recommendations per user")
    parser.add_argument("--lambda", type=float, default=0.7, dest="lambda_param",
                        help="MMR lambda (0=diversity, 1=relevance)")
    parser.add_argument("--skip-eval", action="store_true", help="Skip evaluation step")
    args = parser.parse_args()

    print("=" * 60)
    print("Nightly Recommendation Computation")
    print("=" * 60)
    print(f"  limit:  {args.limit}")
    print(f"  lambda: {args.lambda_param}")
    print()

    # --- Compute ---
    start = time.time()
    stats = recommendation_engine.compute_all_users(limit=args.limit, lambda_param=args.lambda_param)
    elapsed = time.time() - start

    print(f"  Total users:     {stats['total_users']}")
    print(f"  Processed:       {stats['processed']}")
    print(f"  Failed:          {stats['failed']}")
    if stats["failed_ids"]:
        print(f"  Failed IDs:      {', '.join(stats['failed_ids'][:10])}")
    print(f"  Elapsed:         {elapsed:.1f}s")

    # --- Evaluate ---
    if not args.skip_eval:
        print()
        print("Running evaluation...")
        eval_start = time.time()
        try:
            metrics = evaluate_all_users(k=10)
            eval_elapsed = time.time() - eval_start
            print(f"  Users evaluated:  {metrics['num_users_evaluated']}")
            print(f"  Precision@{metrics['k']}:    {metrics['precision_at_k']}")
            print(f"  NDCG@{metrics['k']}:         {metrics['ndcg_at_k']}")
            print(f"  Eval elapsed:     {eval_elapsed:.1f}s")
        except Exception as e:
            print(f"  Evaluation failed: {e}")

    print()
    print("=" * 60)
    print("Done.")


if __name__ == "__main__":
    main()
