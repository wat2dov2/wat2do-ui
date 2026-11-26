#!/usr/bin/env python3
"""Handle one Instagram notification with the notification agent.

``run`` reads the "Handle notification" workflow's dispatch (category, school account,
sender, time) as JSON on stdin and hands it to ``services/instagram_sessions/notification.py``
on the emulator. It prints only the case and the moves made, since the workflow's log is
public; the full report stays in ``~/.local/state/wat2do/notification-agent/``.

``dry-run <threads.jsonl>`` runs the same prompt over recorded inbox reads (one JSON line
per school: ``{"school", "threads": [{"name", "request", "messages", ...}]}``), one run per
thread with messages, with moves that only say what they would do. It writes each
thread's decision to ``--out`` (a local, owner-only file: it holds the replies) and prints
the case counts.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from core.launch_agents import CLAUDE_CODE_PATH  # noqa: E402
from services.claude_code import ClaudeCodeError  # noqa: E402
from services.instagram_sessions import notification  # noqa: E402


def run() -> int:
    try:
        event = notification.Notification.parse(json.loads(sys.stdin.read() or "null"))
    except (ValueError, notification.NotificationError) as exc:
        print(f"Skipped: {exc}")
        return 0
    try:
        outcome = notification.handle(event)
    except ClaudeCodeError as exc:
        # Never the session's own words: they may quote a message.
        print(f"The agent did not finish ({type(exc).__name__}); the run is tried again later")
        return 1
    print(json.dumps(outcome))
    return 0


def dry_run(threads: Path, out: Path, schools: set[str]) -> int:
    decisions = []
    for line in threads.read_text().splitlines():
        record = json.loads(line)
        if schools and record["school"] not in schools:
            continue
        inbox = [
            {key: thread.get(key) for key in ("name", "preview", "age_days", "unread", "request")}
            | {"ours_last": thread.get("ours_last")}
            for thread in record["threads"]
        ]
        for thread in record["threads"]:
            if not thread.get("messages"):
                continue
            event = notification.Notification(
                category="direct_v2_pending" if thread.get("request") else "direct_v2_text",
                account=f"wat2do.{record['school']}",
                sender=thread["name"],
                received_at="",
            )
            recording = {"thread": thread["name"], "messages": thread["messages"], "inbox": inbox}
            try:
                report = notification.dry_run(event, recording)
            except ClaudeCodeError as exc:
                report = {"case": "error", "problems": str(exc)}
            decisions.append({"school": record["school"], "thread": thread["name"], **report})
            print(record["school"], thread["name"], report.get("case"), flush=True)
    descriptor = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        for decision in decisions:
            handle.write(json.dumps(decision, ensure_ascii=False) + "\n")
    print(json.dumps(Counter(decision.get("case") for decision in decisions)))
    return 0


def main() -> int:
    logging.basicConfig(level=logging.WARNING)
    # The runner's PATH may lack Claude Code and the Android tools.
    os.environ["PATH"] = f"{CLAUDE_CODE_PATH}{os.pathsep}{os.environ.get('PATH', '')}"
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Handle the dispatch on stdin")
    rehearse = commands.add_parser("dry-run", help="Run the prompt over recorded threads")
    rehearse.add_argument("threads", type=Path)
    rehearse.add_argument("--out", type=Path, required=True)
    rehearse.add_argument("--school", action="append", default=[])
    args = parser.parse_args()
    if args.command == "run":
        return run()
    return dry_run(args.threads, args.out, set(args.school))


if __name__ == "__main__":
    raise SystemExit(main())
