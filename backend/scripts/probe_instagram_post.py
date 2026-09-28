"""Inspect or transcribe one exact Instagram post without ingestion writes."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import settings  # noqa: E402
from services.scraper.instagram_scraper import InstagramScraperError, get_scraper  # noqa: E402
from services.scraper.single_user import (  # noqa: E402
    exact_post_results_match_targets,
    is_exact_post_url_target,
)
from services.scraper.transcription import (  # noqa: E402
    ReelTranscriptionError,
    require_transcription_key,
    transcribe_post,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--transcribe", action="store_true", help="Return speech and post caption")
    args = parser.parse_args()
    try:
        if not is_exact_post_url_target(args.url):
            raise ReelTranscriptionError("Provide an HTTPS Instagram Reel or post URL.")
        if not settings.apify_api_token:
            raise ReelTranscriptionError("Set APIFY_API_TOKEN in backend/.env before fetching.")
        if args.transcribe:
            require_transcription_key()
        posts = get_scraper().scrape_posts([args.url])
        if not exact_post_results_match_targets([args.url], posts):
            raise ReelTranscriptionError(
                "Instagram did not return the requested post. It may be private or unavailable."
            )
        result = transcribe_post(posts[0]) if args.transcribe else posts[0]
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (InstagramScraperError, ReelTranscriptionError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
