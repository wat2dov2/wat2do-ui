"""Client for Instagram's cache-backed subscription digest query."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from services.instagram_digest.sessions import (
    InstagramSession,
    SessionHealthStatus,
    instagram_cookie_jar,
)

_EXPECTED_QUERY_HOST = "i.instagram.com"
_EXPECTED_QUERY_PATH = "/graphql/query"
_EXPECTED_OPERATION_NAME = "SubscriptionDigestFeedQuery"


class InstagramDigestError(RuntimeError):
    """A sanitized private-query failure suitable for workflow output."""

    def __init__(self, status: SessionHealthStatus, message: str):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class DigestPage:
    media: tuple[dict[str, Any], ...]
    more_available: bool
    max_id: str | None


@dataclass(frozen=True)
class DigestResult:
    media: tuple[dict[str, Any], ...]
    page_count: int
    session: InstagramSession


class InstagramDigestClient:
    """Execute and paginate exactly the app's subscription digest operation."""

    def __init__(
        self,
        session: InstagramSession,
        *,
        endpoint_url: str,
        operation_name: str,
        client_doc_id: str,
        web_app_id: str,
        timeout_seconds: float,
        max_pages: int,
    ):
        endpoint = str(endpoint_url)
        parsed_endpoint = urlsplit(endpoint)
        if (
            parsed_endpoint.scheme != "https"
            or parsed_endpoint.netloc != _EXPECTED_QUERY_HOST
            or parsed_endpoint.path != _EXPECTED_QUERY_PATH
            or parsed_endpoint.query
            or parsed_endpoint.fragment
        ):
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram digest endpoint is invalid",
            )
        if operation_name != _EXPECTED_OPERATION_NAME:
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram digest operation name is invalid",
            )
        if not client_doc_id.isascii() or not client_doc_id.isdigit():
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram digest client document ID must contain only ASCII digits",
            )
        if not web_app_id.isascii() or not web_app_id.isdigit():
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram web app ID must contain only ASCII digits",
            )
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram digest timeout must be positive",
            )
        if max_pages <= 0:
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram digest page limit must be positive",
            )
        self._session = session
        self._endpoint_url = endpoint
        self._operation_name = operation_name
        self._client_doc_id = client_doc_id
        self._web_app_id = web_app_id
        self._timeout = timeout_seconds
        self._max_pages = max_pages

    def fetch_media(self, cache_ent_id: str) -> DigestResult:
        with self._http_client() as http_client:
            return self._fetch_media(http_client, cache_ent_id)

    def _fetch_page(
        self,
        http_client: httpx.Client,
        cache_ent_id: str,
        *,
        max_id: str | None,
    ) -> DigestPage:
        cache_id = cache_ent_id.strip()
        if not cache_id:
            raise InstagramDigestError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram digest cache ID cannot be empty",
            )
        variables = {
            "request": {
                "cache_ent_id": cache_id,
                "max_id": max_id,
            },
            "enable_audience_in_light_media": False,
            "enable_clips_metadata_in_light_media": False,
            "enable_likers_in_full_media": False,
            "enable_thumbnails_in_light_media": False,
            "enable_video_versions_in_light_media": False,
            "exclude_caption_user_field": False,
            "exclude_main_user_field": False,
            "include_attribution_ui_data": False,
        }
        data = {
            "signed_body": "SIGNATURE.",
            "vc_policy": "default",
            "locale": "en_US",
            "client_doc_id": self._client_doc_id,
            "variables": json.dumps(variables, separators=(",", ":")),
            "strip_nulls": "true",
            "strip_defaults": "true",
        }
        try:
            response = http_client.post(self._endpoint_url, data=data)
        except httpx.TimeoutException as exc:
            raise InstagramDigestError(
                SessionHealthStatus.TRANSIENT_ERROR,
                "Instagram digest request timed out",
            ) from exc
        except httpx.TransportError as exc:
            raise InstagramDigestError(
                SessionHealthStatus.TRANSIENT_ERROR,
                "Instagram digest request could not reach Instagram",
            ) from exc
        csrf_token = _cookie_value(http_client.cookies, "csrftoken")
        if csrf_token:
            http_client.headers["X-CSRFToken"] = csrf_token
        payload = _response_payload(response)
        return _parse_page(payload)

    def _fetch_media(self, http_client: httpx.Client, cache_ent_id: str) -> DigestResult:
        media: list[dict[str, Any]] = []
        seen_cursors: set[str] = set()
        max_id: str | None = None

        for page_count in range(1, self._max_pages + 1):
            page = self._fetch_page(http_client, cache_ent_id, max_id=max_id)
            media.extend(page.media)
            if not page.more_available:
                return DigestResult(
                    tuple(media),
                    page_count,
                    _session_from_client(http_client, self._session),
                )
            if page.max_id is None or page.max_id in seen_cursors:
                raise InstagramDigestError(
                    SessionHealthStatus.TRANSIENT_ERROR,
                    "Instagram digest pagination returned an unusable cursor",
                )
            seen_cursors.add(page.max_id)
            max_id = page.max_id

        raise InstagramDigestError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram digest pagination did not reach its terminal page",
        )

    def _http_client(self) -> httpx.Client:
        timezone_offset = datetime.now().astimezone().utcoffset()
        offset_seconds = int(timezone_offset.total_seconds()) if timezone_offset else 0
        return httpx.Client(
            timeout=self._timeout,
            headers={
                "User-Agent": self._session.user_agent,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "X-IG-App-ID": self._web_app_id,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": "https://www.instagram.com/",
                "Origin": "https://www.instagram.com",
                "X-CSRFToken": self._session.csrftoken,
                "X-Client-Doc-Id": self._client_doc_id,
                "X-FB-Friendly-Name": self._operation_name,
                "X-IG-Timezone-Offset": str(offset_seconds),
                "x-graphql-client-library": "minimal",
            },
            cookies=instagram_cookie_jar(self._session.cookies),
        )


def _response_payload(response: httpx.Response) -> dict[str, Any]:
    if response.status_code in {301, 302, 303, 307, 308, 401, 403}:
        raise InstagramDigestError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram digest session requires human reauthorization",
        )
    if response.status_code == 429 or response.status_code >= 500:
        raise InstagramDigestError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram digest is temporarily unavailable",
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise InstagramDigestError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram digest returned an invalid response",
        ) from exc
    if _has_auth_error(payload):
        raise InstagramDigestError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram digest session requires human reauthorization",
        )
    if response.is_error:
        raise InstagramDigestError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram digest request was rejected",
        )
    if not isinstance(payload, dict):
        raise InstagramDigestError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram digest returned an invalid response",
        )
    if payload.get("errors") or payload.get("status") == "fail":
        raise InstagramDigestError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram digest query was rejected",
        )
    return payload


def _parse_page(payload: dict[str, Any]) -> DigestPage:
    try:
        feed = payload["data"]["subscription_digest_feed"]
        items = feed["items"]
        paging_info = feed["paging_info"]
        more_available = paging_info["more_available"]
        max_id = paging_info.get("max_id")
    except (KeyError, TypeError) as exc:
        raise _invalid_page() from exc

    if not isinstance(feed, dict) or not isinstance(items, list):
        raise _invalid_page()
    if not isinstance(paging_info, dict) or not isinstance(more_available, bool):
        raise _invalid_page()
    if max_id is not None and (not isinstance(max_id, str) or not max_id):
        raise _invalid_page()

    media: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("media"), dict):
            raise _invalid_page()
        media.append(item["media"])
    return DigestPage(tuple(media), more_available, max_id)


def _has_auth_error(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    auth_fields = {
        "message": payload.get("message"),
        "error_type": payload.get("error_type"),
        "errors": payload.get("errors"),
    }
    serialized = json.dumps(auth_fields, separators=(",", ":")).lower()
    return any(
        marker in serialized
        for marker in ("login_required", "login required", "challenge", "checkpoint")
    )


def _invalid_page() -> InstagramDigestError:
    return InstagramDigestError(
        SessionHealthStatus.TRANSIENT_ERROR,
        "Instagram digest returned an invalid response",
    )


def _cookie_value(cookies: httpx.Cookies, name: str) -> str | None:
    values = [cookie.value for cookie in cookies.jar if cookie.name == name]
    return values[-1] if values else None


def _session_from_client(
    http_client: httpx.Client,
    original: InstagramSession,
) -> InstagramSession:
    required = {
        name: _cookie_value(http_client.cookies, name)
        for name in ("sessionid", "csrftoken", "ds_user_id")
    }
    if any(not value for value in required.values()):
        raise InstagramDigestError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram digest session requires human reauthorization",
        )
    return InstagramSession(
        intended_recipient_id=original.intended_recipient_id,
        sessionid=required["sessionid"],
        csrftoken=required["csrftoken"],
        ds_user_id=required["ds_user_id"],
        user_agent=original.user_agent,
        account_username=original.account_username,
        mid=_cookie_value(http_client.cookies, "mid"),
        ig_did=_cookie_value(http_client.cookies, "ig_did"),
        rur=_cookie_value(http_client.cookies, "rur"),
    )
