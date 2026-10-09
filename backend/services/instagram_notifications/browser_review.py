"""Lossless, bounded review snapshots in the browser queue's SQLite transaction."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sqlite3
import zlib
from typing import Any

from core.controlbox import controlbox

CONTROL = controlbox.instagram_browser
_MAXIMUM_DEPTH = 64
_MIB = 1024 * 1024
_DIGEST = re.compile(r"[a-f0-9]{64}")
_ERROR = "Browser review snapshot is unavailable or exceeds storage limits; preserve the prior checkpoint and inspect review storage."


class ReviewSnapshotError(ValueError):
    """A sanitized review-storage failure that must not erase a review hold."""


def _json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        pass
    raise ReviewSnapshotError(_ERROR)


def _json_value(data: bytes) -> Any:
    try:
        return json.loads(data)
    except (ValueError, UnicodeError, RecursionError):
        pass
    raise ReviewSnapshotError(_ERROR)


def _check_depth(value: Any, depth: int = 0) -> None:
    if depth > _MAXIMUM_DEPTH:
        raise ReviewSnapshotError(_ERROR)
    if isinstance(value, dict):
        for item in value.values():
            _check_depth(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _check_depth(item, depth + 1)


def _artifact_text_bytes(text: str) -> int:
    if not isinstance(text, str) or len(text) > CONTROL.review_snapshot_max_bytes:
        raise ReviewSnapshotError(_ERROR)
    size = 0
    try:
        for offset in range(0, len(text), 65536):
            size += len(text[offset : offset + 65536].encode("utf-8"))
            if size > CONTROL.review_snapshot_max_bytes:
                raise ReviewSnapshotError(_ERROR)
        return size
    except UnicodeError:
        pass
    raise ReviewSnapshotError(_ERROR)


def _serialize_review_artifact(value: Any, recipe: dict[str, Any]) -> str:
    _check_depth(value, 1)
    encoder = json.JSONEncoder(
        ensure_ascii=recipe["ensure_ascii"],
        indent=recipe["indent"],
        separators=(",", ":") if recipe["separators"] == "compact" else None,
    )
    parts: list[str] = []
    size = int(recipe["trailing_newline"])
    try:
        for part in encoder.iterencode(value):
            size += _artifact_text_bytes(part)
            if size > CONTROL.review_snapshot_max_bytes:
                raise ReviewSnapshotError(_ERROR)
            parts.append(part)
    except (TypeError, ValueError, UnicodeError, RecursionError):
        pass
    else:
        return "".join(parts) + ("\n" if recipe["trailing_newline"] else "")
    raise ReviewSnapshotError(_ERROR)


def encode_review_artifact(text: str) -> dict[str, Any]:
    """Share parsed snapshots only when a native dumps recipe restores exact text."""
    _artifact_text_bytes(text)
    fallback = {"version": 1, "format": "raw", "text": text}
    try:
        value = json.loads(text)
        _check_depth(value, 1)
    except (ValueError, RecursionError):
        return fallback
    match = re.search(r"\n([ \t]+)\S", text)
    indent: int | str | None = None
    if match:
        whitespace = match[1]
        if whitespace == "\t":
            indent = "\t"
        elif whitespace in {"  ", "    "}:
            indent = len(whitespace)
        else:
            return fallback
    for separators in ("default", "compact"):
        recipe = {
            "ensure_ascii": text.isascii(),
            "indent": indent,
            "separators": separators,
            "trailing_newline": text.endswith("\n"),
        }
        try:
            restored = _serialize_review_artifact(value, recipe)
        except ReviewSnapshotError:
            continue
        if restored == text:
            return {"version": 1, "format": "json", "value": value, "recipe": recipe}
    return fallback


def decode_review_artifact(value: Any) -> str:
    """Materialize only the bounded, allowlisted serialization recipes we own."""
    if (
        not isinstance(value, dict)
        or type(value.get("version")) is not int
        or value["version"] != 1
    ):
        raise ReviewSnapshotError(_ERROR)
    if value.get("format") == "raw" and set(value) == {"version", "format", "text"}:
        text = value["text"]
        _artifact_text_bytes(text)
        return str(text)
    if value.get("format") != "json" or set(value) != {"version", "format", "value", "recipe"}:
        raise ReviewSnapshotError(_ERROR)
    recipe = value["recipe"]
    if (
        not isinstance(recipe, dict)
        or set(recipe) != {"ensure_ascii", "indent", "separators", "trailing_newline"}
        or type(recipe["ensure_ascii"]) is not bool
        or type(recipe["trailing_newline"]) is not bool
        or recipe["separators"] not in ("default", "compact")
        or not (
            recipe["indent"] is None
            or type(recipe["indent"]) is int
            and recipe["indent"] in {2, 4}
            or recipe["indent"] == "\t"
        )
    ):
        raise ReviewSnapshotError(_ERROR)
    return _serialize_review_artifact(value["value"], recipe)


class ReviewSnapshotStore:
    """Intern ordered JSON nodes without committing or changing caller values."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def put(self, value: Any) -> dict[str, Any]:
        encoded = _json_bytes(value)
        if len(encoded) > CONTROL.review_snapshot_max_bytes:
            raise ReviewSnapshotError(_ERROR)
        normalized = _json_value(encoded)
        _check_depth(normalized)
        nodes: dict[str, bytes] = {}
        expanded_bytes = 0

        def node(item: Any, raw_length: int, depth: int) -> str:
            nonlocal expanded_bytes
            if depth > _MAXIMUM_DEPTH:
                raise ReviewSnapshotError(_ERROR)
            if raw_length > CONTROL.review_snapshot_chunk_bytes and isinstance(item, dict):
                body = ["object", [[key, edge(child, depth + 1)] for key, child in item.items()]]
            elif raw_length > CONTROL.review_snapshot_chunk_bytes and isinstance(item, list):
                body = ["array", [edge(child, depth + 1) for child in item]]
            else:
                body = ["value", item]
            data = _json_bytes(body)
            expanded_bytes += len(data)
            if expanded_bytes > CONTROL.review_snapshot_max_bytes:
                raise ReviewSnapshotError(_ERROR)
            digest = hashlib.sha256(data).hexdigest()
            if digest not in nodes:
                nodes[digest] = gzip.compress(data, compresslevel=6, mtime=0)
            return digest

        def edge(item: Any, depth: int) -> list[Any]:
            raw_length = len(_json_bytes(item))
            if raw_length <= CONTROL.review_snapshot_chunk_bytes:
                return ["value", item]
            return ["ref", node(item, raw_length, depth)]

        digest = node(normalized, len(encoded), 0)
        # Acquire the caller's write transaction before checking the shared quota.
        # Otherwise two writers can each admit against the same old byte count.
        self._connection.execute("UPDATE review_snapshots SET payload=payload WHERE 0")
        if not self._connection.in_transaction:
            raise ReviewSnapshotError(_ERROR)
        stored_bytes = self._connection.execute(
            "SELECT COALESCE(SUM(length(payload)),0) FROM review_snapshots"
        ).fetchone()[0]
        additions = []
        for key, payload in nodes.items():
            existing = self._connection.execute(
                "SELECT 1 FROM review_snapshots WHERE digest=?", (key,)
            ).fetchone()
            if existing is not None:
                self._read_node(key, CONTROL.review_snapshot_max_bytes)
            else:
                additions.append((key, payload))
        if (
            stored_bytes + sum(len(payload) for _, payload in additions)
            > CONTROL.review_snapshot_storage_max_mb * _MIB
        ):
            raise ReviewSnapshotError(_ERROR)
        self._connection.executemany(
            "INSERT INTO review_snapshots(digest,payload) VALUES (?,?)", additions
        )
        return {"version": 1, "sha256": digest}

    def _read_node(self, digest: str, maximum_bytes: int) -> bytes:
        if not _DIGEST.fullmatch(digest) or maximum_bytes <= 0:
            raise ReviewSnapshotError(_ERROR)
        row = self._connection.execute(
            "SELECT payload FROM review_snapshots WHERE digest=? AND length(payload)<=?",
            (digest, CONTROL.review_snapshot_max_bytes + _MIB),
        ).fetchone()
        if row is None or not isinstance(row[0], bytes):
            raise ReviewSnapshotError(_ERROR)
        try:
            decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16)
            raw = decompressor.decompress(row[0], maximum_bytes + 1)
        except zlib.error:
            raw = None
        if (
            raw is None
            or len(raw) > maximum_bytes
            or not decompressor.eof
            or decompressor.unused_data
            or decompressor.unconsumed_tail
            or hashlib.sha256(raw).hexdigest() != digest
        ):
            raise ReviewSnapshotError(_ERROR)
        return raw

    def get(self, reference: Any) -> Any:
        if (
            not isinstance(reference, dict)
            or set(reference) != {"version", "sha256"}
            or type(reference["version"]) is not int
            or reference["version"] != 1
            or not isinstance(reference["sha256"], str)
            or not _DIGEST.fullmatch(reference["sha256"])
        ):
            raise ReviewSnapshotError(_ERROR)
        remaining = CONTROL.review_snapshot_max_bytes
        raw_cache: dict[str, bytes] = {}

        def materialize(digest: str, depth: int) -> Any:
            nonlocal remaining
            if depth > _MAXIMUM_DEPTH:
                raise ReviewSnapshotError(_ERROR)
            if digest not in raw_cache:
                raw_cache[digest] = self._read_node(digest, remaining)
            raw = raw_cache[digest]
            remaining -= len(raw)
            if remaining < 0:
                raise ReviewSnapshotError(_ERROR)
            # Cache immutable bytes only. json.loads creates fresh objects for
            # each reference, matching independent occurrences in legacy JSON.
            body = _json_value(raw)
            if not isinstance(body, list) or len(body) != 2:
                raise ReviewSnapshotError(_ERROR)
            kind, items = body
            if kind == "value":
                _check_depth(items, depth)
                return items
            if kind == "array" and isinstance(items, list):
                return [expand(item, depth + 1) for item in items]
            if kind == "object" and isinstance(items, list):
                result: dict[str, Any] = {}
                for item in items:
                    if (
                        not isinstance(item, list)
                        or len(item) != 2
                        or not isinstance(item[0], str)
                        or item[0] in result
                    ):
                        raise ReviewSnapshotError(_ERROR)
                    result[item[0]] = expand(item[1], depth + 1)
                return result
            raise ReviewSnapshotError(_ERROR)

        def expand(item: Any, depth: int) -> Any:
            if not isinstance(item, list) or len(item) != 2:
                raise ReviewSnapshotError(_ERROR)
            if item[0] == "value":
                _check_depth(item[1], depth)
                return item[1]
            if item[0] == "ref" and isinstance(item[1], str):
                return materialize(item[1], depth)
            raise ReviewSnapshotError(_ERROR)

        return materialize(reference["sha256"], 0)
