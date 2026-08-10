#!/usr/bin/env python3
"""Backfill permanent organization logos from Instagram profile pictures.

The source profile metadata comes from Apify's dedicated Instagram profile
actor. Instagram CDN URLs are downloaded immediately, validated through the
shared storage service, copied to the canonical ``organization-logos`` S3
prefix, and then persisted in ``organizations.logo_url``.

The operation is re-runnable. Organizations that already have ``logo_url`` are
skipped, and each successful row is committed before the next image starts.
Without ``--apply`` the script only reports eligible rows and makes no Apify,
S3, or database writes.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_ORGANIZATION_LOGOS  # noqa: E402
from schemas.organization import OrganizationUpdate  # noqa: E402
from services import organization_service  # noqa: E402
from services.event_feed_revalidation import event_feed_revalidation_service  # noqa: E402
from services.scraper.image_uploader import upload_image_from_url  # noqa: E402
from services.scraper.instagram_scraper import get_scraper  # noqa: E402
from services.storage_service import storage  # noqa: E402


def normalize_instagram_identifier(value: object) -> str:
    """Return a stable lowercase username or numeric profile id."""
    identifier = str(value or "").strip()
    if not identifier:
        return ""
    if identifier.startswith(("http://", "https://")):
        parsed = urlparse(identifier)
        if parsed.hostname and parsed.hostname.lower().removeprefix("www.") == "instagram.com":
            identifier = parsed.path.strip("/").split("/", 1)[0]
    return identifier.strip().lstrip("@").casefold()


def profile_identifiers(profile: dict[str, Any]) -> set[str]:
    """Identifiers that can map an Apify profile result back to its input."""
    values = {
        normalize_instagram_identifier(profile.get("inputUrl")),
        normalize_instagram_identifier(profile.get("username")),
        normalize_instagram_identifier(profile.get("id")),
    }
    return values - {""}


def _profile_picture_url(profile: dict[str, Any]) -> str | None:
    value = profile.get("profilePicUrlHD") or profile.get("profilePicUrl")
    return str(value).strip() if value else None


def _delete_uploaded_logo(url: str) -> None:
    path = storage.path_from_url(url, BUCKET_ORGANIZATION_LOGOS)
    if path:
        storage.delete_file(BUCKET_ORGANIZATION_LOGOS, path)


def backfill_school(school: str) -> tuple[int, int, int]:
    """Backfill one school and return ``(eligible, updated, failed)``."""
    organizations, _ = organization_service.list_organizations(
        school=school,
        limit=1000,
    )
    eligible = [
        organization
        for organization in organizations
        if organization.ig and not organization.logo_url
    ]
    by_identifier: dict[str, list] = defaultdict(list)
    for organization in eligible:
        by_identifier[normalize_instagram_identifier(organization.ig)].append(organization)

    profiles = get_scraper().scrape_profiles(list(by_identifier))
    if eligible and not profiles:
        print("Apify returned no profiles", file=sys.stderr)
        return len(eligible), 0, len(eligible)

    updated_ids: set[int] = set()
    failed_ids: set[int] = set()
    for profile in profiles:
        matched = {
            organization.id: organization
            for identifier in profile_identifiers(profile)
            for organization in by_identifier.get(identifier, [])
        }
        if not matched:
            continue
        source_url = _profile_picture_url(profile)
        for organization in matched.values():
            if organization.id in updated_ids or organization.id in failed_ids:
                continue
            if not source_url:
                reason = profile.get("error") or "missing profile picture"
                print(
                    f"  profile failed: {organization.id} "
                    f"{organization.organization_name}: {reason}"
                )
                failed_ids.add(organization.id)
                continue
            permanent_url = upload_image_from_url(
                source_url,
                bucket=BUCKET_ORGANIZATION_LOGOS,
            )
            if permanent_url is None:
                print(f"  image failed: {organization.id} {organization.organization_name}")
                failed_ids.add(organization.id)
                continue
            try:
                result = organization_service.update_organization(
                    organization.id,
                    OrganizationUpdate(logo_url=permanent_url),
                )
                if result is None:
                    raise RuntimeError("organization disappeared before update")
            except Exception as exc:  # noqa: BLE001 - continue the resumable batch
                _delete_uploaded_logo(permanent_url)
                print(
                    f"  database failed: {organization.id} {organization.organization_name}: {exc}",
                    file=sys.stderr,
                )
                failed_ids.add(organization.id)
                continue
            updated_ids.add(organization.id)
            print(f"  updated: {organization.id} {organization.organization_name}")

    unresolved_ids = {organization.id for organization in eligible} - updated_ids - failed_ids
    for organization in eligible:
        if organization.id in unresolved_ids:
            print(f"  profile unresolved: {organization.id} {organization.organization_name}")
    failed_ids.update(unresolved_ids)

    if updated_ids:
        event_feed_revalidation_service.revalidate_school(school)
    return len(eligible), len(updated_ids), len(failed_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--school", required=True, help="Registered school slug")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Call Apify, upload to S3, and update organizations",
    )
    args = parser.parse_args()

    organizations, _ = organization_service.list_organizations(
        school=args.school,
        limit=1000,
    )
    eligible = [
        organization
        for organization in organizations
        if organization.ig and not organization.logo_url
    ]
    print(
        f"{args.school}: {len(organizations)} approved organizations, "
        f"{len(eligible)} missing logos with Instagram identifiers"
    )
    if not args.apply:
        print("Dry run only. Re-run with --apply to call Apify and write logos.")
        return 0

    eligible_count, updated_count, failed_count = backfill_school(args.school)
    print(
        f"eligible {eligible_count}, updated {updated_count}, failed or unresolved {failed_count}"
    )
    return 1 if failed_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
