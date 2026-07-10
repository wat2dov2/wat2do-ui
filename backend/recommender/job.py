#!/usr/bin/env python3
"""
Nightly recommendation computation job.

Runs the full CF pipeline for every user and writes pre-computed results
to the user_recommendations table. Designed to be called from GitHub Actions
or manually via CLI.

Usage:
    python recommender/job.py
    python recommender/job.py --limit 30 --lambda 0.6
"""

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

import core.logging  # noqa: F401 - triggers basicConfig for standalone execution
from recommender.config import DEFAULT_LAMBDA, DEFAULT_LIMIT, EVAL_K
from recommender.evaluation import evaluate_all_users
from recommender.service import batch_runner

log = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Compute recommendations for all users")
    parser.add_argument(
        "--limit", type=int, default=DEFAULT_LIMIT, help="Max recommendations per user"
    )
    parser.add_argument(
        "--lambda",
        type=float,
        default=DEFAULT_LAMBDA,
        dest="lambda_param",
        help="MMR lambda (0=diversity, 1=relevance)",
    )
    parser.add_argument("--skip-eval", action="store_true", help="Skip evaluation step")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("Nightly Recommendation Computation")
    log.info("=" * 60)
    log.info("  limit:  %s", args.limit)
    log.info("  lambda: %s", args.lambda_param)

    start = time.time()
    stats = batch_runner.compute_all_users(limit=args.limit, lambda_param=args.lambda_param)
    elapsed = time.time() - start

    log.info("  Total users:     %s", stats["total_users"])
    log.info("  Processed:       %s", stats["processed"])
    log.info("  Failed:          %s", stats["failed"])
    if stats["failed_ids"]:
        log.info("  Failed IDs:      %s", ", ".join(stats["failed_ids"][:10]))
    log.info("  Elapsed:         %.1fs", elapsed)

    if stats["total_users"] > 0:
        failure_rate = stats["failed"] / stats["total_users"]
        if failure_rate > 0.5:
            log.error("Failure rate %.0f%% exceeds 50%% threshold - aborting", failure_rate * 100)
            sys.exit(1)

    if not args.skip_eval:
        log.info("Running evaluation...")
        eval_start = time.time()
        try:
            metrics = evaluate_all_users(k=EVAL_K)
            eval_elapsed = time.time() - eval_start
            log.info("  Users evaluated:  %s", metrics["num_users_evaluated"])
            log.info("  Precision@%s:    %s", metrics["k"], metrics["precision_at_k"])
            log.info("  NDCG@%s:         %s", metrics["k"], metrics["ndcg_at_k"])
            log.info("  Eval elapsed:     %.1fs", eval_elapsed)
        except Exception as e:
            log.error("Evaluation failed - recommendation quality unknown: %s", e, exc_info=True)

    log.info("=" * 60)
    log.info("Done.")


if __name__ == "__main__":
    main()
