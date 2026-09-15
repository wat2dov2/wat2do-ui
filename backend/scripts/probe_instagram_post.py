"""Run Apify for one exact post and print its data without ingestion writes."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.scraper.instagram_scraper import InstagramScraperError, get_scraper  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(get_scraper().scrape_posts([args.url])[0], ensure_ascii=False))
    except InstagramScraperError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
