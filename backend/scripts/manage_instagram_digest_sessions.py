#!/usr/bin/env python3
"""Manage recipient-scoped Instagram digest sessions in macOS Keychain."""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv()

from core.controlbox import controlbox  # noqa: E402
from services.instagram_digest.sessions import (  # noqa: E402
    InstagramSession,
    KeychainSessionStore,
    SessionHealthAudit,
    SessionHealthIssue,
    SessionHealthStatus,
    SessionStoreError,
    audit_notification_sessions,
    prime_browser_session,
    recipient_session_transaction,
)

_CONTROL = controlbox.instagram_digest
_EXIT_BY_STATUS = {
    SessionHealthStatus.REAUTHORIZATION_REQUIRED: 3,
    SessionHealthStatus.TRANSIENT_ERROR: 1,
    SessionHealthStatus.CONFIGURATION_ERROR: 2,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    store = commands.add_parser("store", help="Interactively store one recipient session")
    store.add_argument("intended_recipient_id")

    commands.add_parser("list", help="List stored recipient IDs without reading secrets")

    check = commands.add_parser("check", help="Validate local Keychain session items")
    check.add_argument("intended_recipient_id", nargs="?")

    health = commands.add_parser(
        "health",
        help="Remotely validate every routed and indexed session",
    )
    health.add_argument("--report-file", type=Path, required=True)

    remove = commands.add_parser("remove", help="Remove one recipient session")
    remove.add_argument("intended_recipient_id")
    remove.add_argument("--yes", action="store_true", help="Skip the confirmation prompt")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store = KeychainSessionStore()
    try:
        if args.command == "store":
            session = _prompt_for_session(args.intended_recipient_id)
            with recipient_session_transaction(session.intended_recipient_id):
                store.store(session)
            print(f"Stored Instagram digest session for {session.intended_recipient_id}")
            return 0
        if args.command == "list":
            for recipient_id in store.list_recipient_ids():
                print(recipient_id)
            return 0
        if args.command == "check":
            health = (
                (store.local_health(args.intended_recipient_id),)
                if args.intended_recipient_id
                else store.all_local_health()
            )
            for item in health:
                account = f" @{item.account_username}" if item.account_username else ""
                print(f"{item.intended_recipient_id}{account}: {item.status.value}")
            return 0 if all(item.status is SessionHealthStatus.HEALTHY for item in health) else 1
        if args.command == "health":
            audit = _health_audit(store)
            try:
                args.report_file.write_text(
                    json.dumps(audit.report_fields(), indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
            except OSError:
                print(
                    "configuration_error: Instagram health report could not be written",
                    file=sys.stderr,
                )
                return 2
            outcome = "healthy" if audit.healthy else "failed"
            print(f"Checked {len(audit.sessions)} Instagram digest session(s): {outcome}")
            return 0 if audit.healthy else 1
        if not args.yes:
            confirmation = input(
                f"Remove Instagram digest session for {args.intended_recipient_id}? [y/N] "
            )
            if confirmation.strip().lower() != "y":
                print("No session removed")
                return 0
        with recipient_session_transaction(args.intended_recipient_id):
            store.delete(args.intended_recipient_id)
        print(f"Removed Instagram digest session for {args.intended_recipient_id}")
        return 0
    except SessionStoreError as exc:
        print(f"{exc.status.value}: {exc}", file=sys.stderr)
        return _EXIT_BY_STATUS.get(exc.status, 1)


def _prompt_for_session(intended_recipient_id: str) -> InstagramSession:
    session = prime_browser_session(
        getpass.getpass("sessionid: ").strip(),
        getpass.getpass("browser user agent: ").strip(),
        timeout_seconds=_CONTROL.request_timeout_seconds,
    )
    if session.intended_recipient_id != intended_recipient_id:
        raise SessionStoreError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram session identity does not match its intended recipient",
        )
    return session


def _health_audit(store: KeychainSessionStore) -> SessionHealthAudit:
    try:
        return audit_notification_sessions(
            store,
            timeout_seconds=_CONTROL.request_timeout_seconds,
        )
    except Exception:
        return SessionHealthAudit(False, (SessionHealthIssue.AUDIT_FAILED,), ())


if __name__ == "__main__":
    raise SystemExit(main())
