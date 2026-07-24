from __future__ import annotations

import time
from typing import Any

import httpx

from core.controlbox import controlbox


class MetaInstagramClient:
    """Small Graph API client for resumable carousel publishing."""

    def __init__(self, access_token: str):
        config = controlbox.instagram_publishing
        self._base_url = f"https://graph.facebook.com/{config.graph_api_version}"
        self._headers = {"Authorization": f"Bearer {access_token}"}
        self._poll_attempts = config.meta_poll_attempts
        self._poll_interval = config.meta_poll_interval_seconds

    def create_image_container(self, instagram_user_id: str, image_url: str) -> str:
        payload = self._post(
            f"/{instagram_user_id}/media",
            {
                "image_url": image_url,
                "is_carousel_item": "true",
            },
        )
        return _required_id(payload)

    def create_carousel_container(
        self,
        instagram_user_id: str,
        *,
        child_ids: list[str],
        caption: str,
    ) -> str:
        payload = self._post(
            f"/{instagram_user_id}/media",
            {
                "media_type": "CAROUSEL",
                "children": ",".join(child_ids),
                "caption": caption,
            },
        )
        return _required_id(payload)

    def publish(self, instagram_user_id: str, creation_id: str) -> str:
        payload = self._post(
            f"/{instagram_user_id}/media_publish",
            {"creation_id": creation_id},
        )
        return _required_id(payload)

    def wait_until_ready(self, container_id: str) -> None:
        for _ in range(self._poll_attempts):
            payload = self._get(f"/{container_id}", {"fields": "status_code,status"})
            status_code = str(payload.get("status_code") or "").upper()
            if status_code == "FINISHED":
                return
            if status_code in {"ERROR", "EXPIRED"}:
                detail = str(payload.get("status") or status_code)
                raise RuntimeError(f"Meta media container failed: {detail}")
            time.sleep(self._poll_interval)
        raise RuntimeError("Meta media container did not become ready before the timeout")

    def _get(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        with httpx.Client(timeout=30, headers=self._headers) as client:
            response = client.get(f"{self._base_url}{path}", params=params)
        return _response_json(response)

    def _post(self, path: str, data: dict[str, str]) -> dict[str, Any]:
        with httpx.Client(timeout=30, headers=self._headers) as client:
            response = client.post(f"{self._base_url}{path}", data=data)
        return _response_json(response)


def _response_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Meta Graph API returned HTTP {response.status_code}") from exc
    if response.is_error:
        error = payload.get("error") if isinstance(payload, dict) else None
        message = error.get("message") if isinstance(error, dict) else None
        raise RuntimeError(message or f"Meta Graph API returned HTTP {response.status_code}")
    if not isinstance(payload, dict):
        raise RuntimeError("Meta Graph API returned an invalid response")
    return payload


def _required_id(payload: dict[str, Any]) -> str:
    value = payload.get("id")
    if not value:
        raise RuntimeError("Meta Graph API response did not include an ID")
    return str(value)
