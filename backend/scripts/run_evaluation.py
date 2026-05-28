#!/usr/bin/env python3
"""CLI script to run offline evaluation of the recommendation engine."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from recommender.evaluation import evaluate_all_users


def main():
    print("Running recommendation engine evaluation...")
    print("=" * 50)

    for k in [5, 10, 20]:
        results = evaluate_all_users(k=k)
        print(f"\n  K = {k}")
        print(f"  Users evaluated: {results['num_users_evaluated']}")
        print(f"  Precision@{k}:    {results['precision_at_k']:.4f}")
        print(f"  NDCG@{k}:         {results['ndcg_at_k']:.4f}")

    print("\n" + "=" * 50)
    print("Done.")


if __name__ == "__main__":
    main()
