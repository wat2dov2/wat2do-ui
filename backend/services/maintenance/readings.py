"""What the watchdog reads: the production database (read-only), the Mac's job logs and
state files, launchd, adb, GitHub and both Claude logins.

Each reader returns plain numbers for `judges.py`. None of them changes anything, and
none returns a secret, a message's text or a sender: the emulator's login file is
parsed in memory for usernames only.
"""

from __future__ import annotations

import html
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo

from core.config import settings
from core.controlbox import MaintenanceControl, controlbox
from core.launch_agents import CLAUDE_CODE_PATH, INSTAGRAM_BROWSER_BINARY
from services import notification_recording
from services.claude_code import claude_environment, remove_run_folder
from services.instagram_accounts import school_account_username
from services.instagram_emulator.device import adb_path

TORONTO = ZoneInfo("America/Toronto")
STATE = Path.home() / ".local/state/wat2do"
BROWSER_STATE = STATE / "instagram-browser"
NOTIFICATION_LOG = STATE / "notification-log"
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
# A Following read Instagram refused, as the Lightpanda lane logs it (the messages in
# rust/src/instagram_notifications/browser_following.rs).
_FOLLOWING_REFUSAL = re.compile(
    r"Lightpanda job \S+ failed for (\S+): (?:Instagram Following read failed with HTTP 429"
    r"|Instagram refused a Following read|Instagram Following response was not valid JSON"
    r"|Instagram asked for a login on a Following read)"
)
_LIMIT = re.compile(r"usage limit|weekly limit|hit your .{0,20}limit", re.IGNORECASE)


class Context:
    """One watchdog pass: its clock, its settings and the log offsets it carries over."""

    def __init__(self, control: MaintenanceControl, state: dict[str, Any], now: datetime) -> None:
        self.control = control
        self.state = state
        self.now = now
        self.local = now.astimezone(TORONTO)
        self._recorded: notification_recording.Recorded | None = None
        self._log_texts: dict[Path, tuple[str, float]] = {}

    def recorded(self) -> notification_recording.Recorded:
        """The notification recorder's recent lines, read once per pass."""
        if self._recorded is None:
            self._recorded = notification_recording.read_recorded(NOTIFICATION_LOG)
        return self._recorded

    def run(
        self, command: list[str], *, timeout: float | None = None, env: dict[str, str] | None = None
    ) -> str:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout or self.control.command_timeout_seconds,
            env=env,
        )
        if result.returncode:
            raise RuntimeError(f"{Path(command[0]).name} exited {result.returncode}")
        return result.stdout

    def new_log_text(self, path: Path) -> tuple[str, float]:
        """What `path` gained since the last pass, and how many hours that covers, read
        once per pass however many checks ask. The first pass only marks where the file
        ends."""
        if path not in self._log_texts:
            self._log_texts[path] = self._read_new_log_text(path)
        return self._log_texts[path]

    def _read_new_log_text(self, path: Path) -> tuple[str, float]:
        offsets = self.state.setdefault("offsets", {})
        key = str(path)
        size = path.stat().st_size if path.exists() else 0
        previous = offsets.get(key)
        offsets[key] = {"offset": size, "at": self.now.isoformat()}
        if not previous:
            return "", 0.0
        start = previous["offset"] if previous["offset"] <= size else 0
        hours = (self.now - datetime.fromisoformat(previous["at"])).total_seconds() / 3600
        with path.open("rb") as handle:
            handle.seek(start)
            return _ANSI.sub("", handle.read(size - start).decode("utf-8", "replace")), hours


def _query(sql: str, context: Context) -> Any:
    """One read-only production query in its own session (AGENTS.md's read-only rules)."""
    url = urlparse(settings.database_url)
    environment = {
        "PATH": CLAUDE_CODE_PATH,
        "HOME": str(Path.home()),
        "PGHOST": url.hostname or "127.0.0.1",
        "PGPORT": str(url.port or 5432),
        "PGUSER": unquote(url.username or ""),
        "PGPASSWORD": unquote(url.password or ""),
        "PGDATABASE": url.path.lstrip("/"),
        "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=10000"
        " -c idle_in_transaction_session_timeout=15000",
    }
    psql = shutil.which("psql", path=CLAUDE_CODE_PATH) or "psql"
    out = context.run(
        [psql, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], env=environment
    )
    answer = json.loads(out)
    if answer.pop("read_only") != "on":
        raise RuntimeError("the database session was not read-only")
    return answer


def database(context: Context) -> dict[str, Any]:
    """Instagram items per hour and per school, today's carousels, the approved clubs'
    follows and the Graph tokens."""
    control = context.control
    hours = (control.baseline_days + 1) * 24
    return _query(
        f"""
        with items as (
          select i.created_at, s.slug
          from ingestion_items i left join schools s on s.id = i.school_id
          where i.source = 'instagram' and i.created_at > now() - interval '{hours} hours'
        ), batches as (
          select b.*, s.slug from instagram_publish_batches b left join schools s on s.id = b.school_id
          where b.local_date = (now() at time zone 'America/Toronto')::date
        )
        select json_build_object(
          'read_only', current_setting('default_transaction_read_only'),
          'hours', (select coalesce(json_object_agg(h, c), '{{}}') from (
             select floor(extract(epoch from now() - created_at) / 3600)::int h, count(*) c
             from items group by 1) x),
          'last_item_minutes', (select extract(epoch from now() - max(created_at)) / 60 from items),
          'school_days', (select coalesce(json_agg(json_build_array(slug, d, c)), '[]') from (
             select slug, floor(extract(epoch from now() - created_at) / 86400)::int d, count(*) c
             from items where slug is not null group by 1, 2) x),
          'schools', (select coalesce(json_agg(slug), '[]') from schools where not hidden),
          'batch_statuses', (select coalesce(json_object_agg(status, c), '{{}}') from (
             select status, count(*) c from batches group by 1) x),
          'batch_failures', (select coalesce(json_agg(json_build_object(
             'school', coalesce(slug, account_key), 'error', left(coalesce(error_message, 'no error saved'), 160))), '[]')
             from batches where status = 'failed'),
          'music_failed', (select count(*) from batches where status = 'published' and music_status = 'failed'),
          'story_failed', (select count(*) from batches where status = 'published' and story_status = 'failed'),
          'token_problems', (select coalesce(json_agg(json_build_object('account', account_key, 'problem', problem)), '[]') from (
             select account_key, case
               when requires_reauthorization then 'needs a new token (reauthorization)'
               when refresh_error is not null then 'token refresh failed: ' || left(refresh_error, 100)
               else 'token expires ' || expires_at::date end problem
             from instagram_publishing_accounts
             where enabled and (requires_reauthorization or refresh_error is not null
                                or expires_at < now() + interval '7 days')
             union all
             select distinct account_key, 'token invalid: ' || left(error_message, 100)
             from instagram_publish_batches
             where status = 'failed' and error_message ilike '%access token%'
               and local_date >= (now() at time zone 'America/Toronto')::date - 1) t),
          'follows', (with clubs as (
               select c.id, c.club_name, c.school_id, c.created_at,
                      lower(trim(both '@' from c.ig)) handle,
                      exists (select 1 from club_members m where m.club_id = c.id) claimed
               from clubs c
               where c.status = 'approved' and coalesce(trim(c.ig), '') <> ''
                 and c.school_id in (select distinct school_id from instagram_follow_candidates)
             ), joined as (
               select c.*, s.slug, f.status, f.reason, f.updated_at
               from clubs c join schools s on s.id = c.school_id
               left join instagram_follow_candidates f
                 on f.school_id = c.school_id and f.handle = c.handle
             )
             select json_build_object(
               'unsynced', (select coalesce(json_agg(slug || ' @' || handle), '[]') from (
                  select slug, handle from joined where status is null
                    and coalesce(created_at, now() - interval '1 year')
                        < now() - interval '{control.follow_sync_hours} hours'
                  order by slug, handle limit 20) x),
               'unsynced_count', (select count(*) from joined where status is null
                  and coalesce(created_at, now() - interval '1 year')
                      < now() - interval '{control.follow_sync_hours} hours'),
               'gone', (select coalesce(json_agg(slug || ' @' || handle), '[]') from (
                  select slug, handle from joined
                  where status = 'rejected' and reason = 'Profile is gone or hidden'
                  order by updated_at desc nulls last limit 20) x),
               'gone_count', (select count(*) from joined
                  where status = 'rejected' and reason = 'Profile is gone or hidden'),
               'claimed_not_followed', (select coalesce(json_agg(slug || ' @' || handle || ' (' || status || ')'), '[]') from (
                  select slug, handle, status from joined
                  where claimed and status in ('rejected', 'unfollow') order by slug, handle limit 20) x),
               'unfollow_count', (select count(*) from joined where status = 'unfollow'),
               'backlog_count', (select count(*) from instagram_follow_candidates
                  where status = 'approved'
                    and coalesce(decided_at, updated_at) < now() - interval '{control.follow_backlog_days} days')
             )),
          'stale_snapshots', (select coalesce(json_agg(a.account_key order by a.account_key), '[]')
             from instagram_publishing_accounts a
             where a.enabled and coalesce((select max(captured_on) from instagram_account_snapshots s
                   where s.account_key = a.account_key), date '2000-01-01')
                   < current_date - {control.snapshot_max_age_days})
        )
        """,
        context,
    )


def ingestion(rows: dict[str, Any], context: Context) -> dict[str, Any]:
    control = context.control
    hours = {int(hour): count for hour, count in rows["hours"].items()}

    def total(start: int, length: int) -> int:
        return sum(hours.get(hour, 0) for hour in range(start, start + length))

    window = control.ingestion_window_hours
    days = range(1, control.baseline_days + 1)
    per_school: dict[str, dict[int, int]] = defaultdict(dict)
    for slug, day, count in rows["school_days"]:
        per_school[slug][day] = count
    return {
        "window_now": total(0, window),
        "window_baseline": [total(24 * day, window) for day in days],
        "day_now": total(0, 24),
        "day_baseline": [total(24 * day, 24) for day in days],
        "last_item_minutes": rows["last_item_minutes"],
        "no_digest": sorted(_schools_without_digest(rows["schools"], context)),
        "schools": {
            slug: {
                "today": per_school[slug].get(0, 0),
                "baseline": [per_school[slug].get(day, 0) for day in days],
            }
            for slug in rows["schools"]
        },
    }


def _schools_without_digest(schools: list[str], context: Context) -> set[str]:
    since = context.now - timedelta(hours=context.control.school_digest_hours)
    digests = context.recorded().digest_by_account
    return {
        school
        for school in schools
        if digests.get(school_account_username(school), datetime.min.replace(tzinfo=timezone.utc))
        < since
    }


def carousels(rows: dict[str, Any], context: Context) -> dict[str, Any]:
    return {
        "hour": context.local.hour,
        "statuses": rows["batch_statuses"],
        "failures": rows["batch_failures"],
        "music_failed": rows["music_failed"],
        "story_failed": rows["story_failed"],
    }


def follows(rows: dict[str, Any], _context: Context) -> dict[str, Any]:
    return rows["follows"]


def graph_tokens(rows: dict[str, Any], _context: Context) -> dict[str, Any]:
    return {"token_problems": rows["token_problems"], "stale_snapshots": rows["stale_snapshots"]}


def brave(context: Context) -> dict[str, Any]:
    status = json.loads(
        context.run(
            [str(INSTAGRAM_BROWSER_BINARY), "--state-directory", str(BROWSER_STATE), "status"]
        )
    )
    heartbeat = (status.get("worker") or {}).get("heartbeat")
    since = context.now.timestamp() - context.control.brave_window_hours * 3600
    with sqlite3.connect(
        f"file:{BROWSER_STATE / 'jobs.sqlite3'}?mode=ro", uri=True, timeout=5
    ) as db:
        rows = db.execute(
            "select kind, state, count(*) from jobs where coalesce(finished_at, created_at) > ? group by 1, 2",
            (since,),
        ).fetchall()
    jobs: dict[str, dict[str, int]] = defaultdict(dict)
    for kind, state, count in rows:
        jobs[kind][state] = count
    # The live (Rust) worker logs here; worker.operations.log is the old Python worker's.
    text, log_hours = context.new_log_text(BROWSER_STATE / "worker.stderr.log")
    error_lines = sum(1 for line in text.splitlines() if line.startswith("ERROR"))
    return {
        "status": {
            key: status.get(key) for key in ("paused", "accounts_paused", "accounts_missing")
        },
        "heartbeat_age_seconds": None if heartbeat is None else context.now.timestamp() - heartbeat,
        "jobs": dict(jobs),
        "error_lines": error_lines,
        "log_hours": log_hours,
    }


def following_guard(context: Context) -> dict[str, Any]:
    """Refused Following reads per account in the last hour, and the accounts whose
    breaker is open. The Lightpanda lane names the account of each refusal in the
    worker log; the account guard (`account_guard:<account>` in the queue) counts
    Brave's too. The larger count for each account is kept."""
    text, log_hours = context.new_log_text(BROWSER_STATE / "worker.stderr.log")
    from_log: dict[str, int] = defaultdict(int)
    for match in _FOLLOWING_REFUSAL.finditer(text):
        from_log[match.group(1)] += 1
    per_hour = {
        account: round(count / log_hours) if log_hours > 1 else count
        for account, count in from_log.items()
    }
    now = context.now.timestamp()
    tripped: dict[str, str] = {}
    with sqlite3.connect(
        f"file:{BROWSER_STATE / 'jobs.sqlite3'}?mode=ro", uri=True, timeout=5
    ) as db:
        rows = db.execute(
            "select key, value from settings where key like 'account_guard:%'"
        ).fetchall()
    for key, raw in rows:
        account = key.removeprefix("account_guard:")
        guard = json.loads(raw) or {}
        recent = sum(1 for at in guard.get("refusal_times") or [] if now - at < 3600)
        per_hour[account] = max(per_hour.get(account, 0), recent)
        if guard.get("tripped_at") is not None:
            tripped[account] = guard.get("tripped_reason") or ""
    return {
        "refusals_last_hour": {account: count for account, count in per_hour.items() if count},
        "tripped": tripped,
    }


def launch_agent(label: str, context: Context) -> dict[str, Any]:
    result = subprocess.run(
        ["launchctl", "print", f"gui/{os.getuid()}/{label}"],
        capture_output=True,
        text=True,
        timeout=context.control.command_timeout_seconds,
    )
    if result.returncode:
        return {"loaded": False, "pid": None, "last_exit": None}
    pid = re.search(r"^\s*pid = (\d+)", result.stdout, re.MULTILINE)
    last_exit = re.search(r"^\s*last exit code = (-?\d+)", result.stdout, re.MULTILINE)
    return {
        "loaded": True,
        "pid": int(pid.group(1)) if pid else None,
        "last_exit": int(last_exit.group(1)) if last_exit else None,
    }


def launch_agents(context: Context) -> dict[str, Any]:
    control = context.control
    agents = {
        label: launch_agent(label, context)
        for label in (*control.keep_alive_agents, *control.scheduled_agents)
    }
    retry_log = STATE / "notification-retry/retry.stdout.log"
    blocked = None
    retry_minutes = None
    if retry_log.exists():
        retry_minutes = (context.now.timestamp() - retry_log.stat().st_mtime) / 60
        lines = retry_log.read_text(encoding="utf-8", errors="replace").strip().splitlines()
        try:
            blocked = json.loads(lines[-1]).get("blocked") if lines else None
        except ValueError:
            blocked = None
    return {"agents": agents, "retry_log_minutes": retry_minutes, "retry_blocked": blocked}


def ingestion_processor(context: Context) -> dict[str, Any]:
    text, _hours = context.new_log_text(STATE / "ingestion/process.stderr.log")
    running = launch_agent("io.wat2do.ingestion.process", context)["pid"] is not None
    return {
        "running": running,
        "limit_lines": sum(1 for line in text.splitlines() if _LIMIT.search(line)),
    }


def awake_minutes(start: datetime, end: datetime, quiet_until_hour: int) -> float:
    """Minutes from start to end, leaving out each Toronto night from midnight to
    `quiet_until_hour`, when hardly any Instagram notification arrives."""
    start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    minutes = (end - start).total_seconds() / 60
    day = start.astimezone(TORONTO).date()
    while day <= end.astimezone(TORONTO).date():
        night_start = datetime.combine(day, time(0), TORONTO).astimezone(timezone.utc)
        night_end = datetime.combine(day, time(quiet_until_hour), TORONTO).astimezone(timezone.utc)
        overlap = (min(end, night_end) - max(start, night_start)).total_seconds() / 60
        minutes -= max(0.0, overlap)
        day += timedelta(days=1)
    return minutes


def recorder(context: Context) -> dict[str, Any]:
    emulator = controlbox.instagram_emulator
    recorded = context.recorded()
    last = recorded.by_user
    last_digest = max(recorded.digest_by_account.values(), default=None)
    dispatch = json.loads((NOTIFICATION_LOG / "dispatch.json").read_text(encoding="utf-8"))
    any_last = max(last.values(), default=None)
    return {
        "last_any_minutes": None
        if any_last is None
        else (context.now - any_last).total_seconds() / 60,
        "awake_silence_minutes": None
        if any_last is None
        else awake_minutes(any_last, context.now, context.control.recorder_quiet_until_hour),
        "user_hours": {
            user: (context.now - at).total_seconds() / 3600 for user, at in last.items()
        },
        "expected_users": sorted(set(emulator.android_user_by_school.values())),
        "digest_hours": None
        if last_digest is None
        else (context.now - last_digest).total_seconds() / 3600,
        "dispatch_waiting": len(dispatch.get("waiting") or []),
    }


# Accounts the maintenance agent found silent for a reason only Tony can clear (an
# Instagram challenge), each {"reason", "until"}: until then account_notifications
# lists them as waiting (yellow) instead of starting the agent again and again.
ACCOUNT_WAITS = STATE / "maintenance/account_waits.json"


def account_notifications(context: Context) -> dict[str, Any]:
    """How long ago the recorder heard each school account on the emulator, whatever the
    notification (a post, a digest, a like, a message)."""
    emulator = controlbox.instagram_emulator
    excluded = set(context.control.account_silence_excluded)
    last = context.recorded().by_account
    accounts = {
        school_account_username(school): user
        for school, user in emulator.android_user_by_school.items()
    }
    try:
        waits = json.loads(ACCOUNT_WAITS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        waits = {}
    waiting: dict[str, str] = {}
    for account, wait in waits.items() if isinstance(waits, dict) else ():
        try:
            until = datetime.fromisoformat(str(wait["until"]))
        except (KeyError, TypeError, ValueError):
            continue
        if until.tzinfo is not None and until > context.now:
            waiting[account] = str(wait.get("reason") or "waiting on Tony")[:200]
    return {
        "accounts": {
            account: {
                "android_user": user,
                "hours": None
                if account not in last
                else (context.now - last[account]).total_seconds() / 3600,
            }
            for account, user in sorted(accounts.items())
            if account not in excluded
        },
        "waiting": waiting,
    }


def _minutes_ago(stamp: str, context: Context) -> float:
    return (context.now - datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds() / 60


def workflow(context: Context) -> dict[str, Any]:
    gh = shutil.which("gh", path=CLAUDE_CODE_PATH) or "gh"
    runs = json.loads(
        context.run(
            [
                gh,
                "run",
                "list",
                "--repo",
                controlbox.notification_recording.github_repo,
                "--workflow",
                context.control.workflow_file,
                "-L",
                "300",
                "--json",
                "status,conclusion,createdAt",
            ]
        )
    )
    return {
        "runs": [
            {
                "status": run["status"],
                "conclusion": run["conclusion"],
                "minutes_ago": _minutes_ago(run["createdAt"], context),
            }
            for run in runs
        ]
    }


def runners(context: Context) -> dict[str, str]:
    gh = shutil.which("gh", path=CLAUDE_CODE_PATH) or "gh"
    listed = json.loads(
        context.run(
            [gh, "api", f"repos/{controlbox.notification_recording.github_repo}/actions/runners"]
        )
    )
    return {runner["name"]: runner["status"] for runner in listed.get("runners", [])}


def notification_agent(context: Context) -> dict[str, int]:
    since = context.now - timedelta(hours=context.control.workflow_window_hours)
    reports = errors = 0
    for day in {since.astimezone(TORONTO).date(), context.local.date()}:
        path = STATE / f"notification-agent/{day.isoformat()}.jsonl"
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                row = json.loads(line)
                ended = datetime.fromisoformat(row["ended"])
            except (ValueError, KeyError, TypeError):
                continue
            if ended < since:
                continue
            reports += 1
            report = row.get("report")
            errors += isinstance(report, dict) and report.get("case") == "error"
    return {"reports": reports, "errors": errors}


def _logged_in(user: int, adb: str, context: Context) -> set[str]:
    """Usernames in the Instagram app's saved logins on one Android user; the file's
    other keys (one-tap nonces) are never kept or printed."""
    package = controlbox.instagram_emulator.instagram_package
    prefs = f"/data/user/{user}/{package}/shared_prefs/{package}_preferences.xml"
    text = context.run(
        [adb, "-s", controlbox.instagram_emulator.serial, "shell", f"su 0 cat {prefs}"]
    )
    found = re.search(r'<string name="user_access_map">(.*?)</string>', text, re.DOTALL)
    if not found:
        return set()
    return {
        entry.get("user_info", {}).get("username", "")
        for entry in json.loads(html.unescape(found.group(1)))
    }


def emulator(context: Context) -> dict[str, Any]:
    control = controlbox.instagram_emulator
    adb = adb_path()
    try:
        state = context.run([adb, "-s", control.serial, "get-state"], timeout=15).strip()
    except (RuntimeError, subprocess.SubprocessError, OSError) as error:
        state = f"unreachable: {error}"
    missing: list[str] = []
    if state == "device":
        expected: dict[int, list[str]] = defaultdict(list)
        for school, user in control.android_user_by_school.items():
            expected[user].append(school_account_username(school))
        for user, accounts in sorted(expected.items()):
            logged_in = _logged_in(user, adb, context)
            missing += [account for account in accounts if account not in logged_in]
    cpu = None
    for line in context.run(["ps", "-axww", "-o", "%cpu=,command="]).splitlines():
        if "qemu-system" in line and control.avd_name in line:
            cpu = float(line.split()[0])
    restarts = 0
    restarts_log = STATE / "instagram-emulator-restarts.log"
    if restarts_log.exists():
        since = context.now - timedelta(hours=24)
        for line in restarts_log.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                restarts += datetime.fromisoformat(line.split(" ", 1)[0]) >= since
            except ValueError:
                continue
    return {
        "adb_state": state,
        "missing_logins": sorted(missing),
        "qemu_cpu_percent": cpu,
        "restarts_24h": restarts,
    }


def host(context: Context) -> dict[str, float]:
    swap = context.run(["sysctl", "-n", "vm.swapusage"])
    used = re.search(r"used = ([\d.]+)([MG])", swap)
    used_gb = 0.0 if not used else float(used.group(1)) / (1024 if used.group(2) == "M" else 1)
    return {"disk_free_gb": shutil.disk_usage(Path.home()).free / 1024**3, "swap_used_gb": used_gb}


def sittings(context: Context) -> dict[str, Any]:
    folder = STATE / "instagram-sittings"
    today = context.local.date().isoformat()
    sat_file = folder / "sat.json"
    sat = (
        json.loads(sat_file.read_text(encoding="utf-8")).get(today, {}).get("sat", [])
        if sat_file.exists()
        else []
    )
    failed = 0
    log = folder / f"{today}.jsonl"
    if log.exists():
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                failed += json.loads(line).get("ok") is False
            except ValueError:
                continue
    return {"hour": context.local.hour, "sat": sat, "failed_moves": failed}


def _probe(config_dir: str | None, context: Context) -> str:
    """Ask one Claude login for one word: ok, limited, logged out or failing."""
    executable = shutil.which("claude", path=CLAUDE_CODE_PATH)
    if executable is None:
        return "missing (Claude Code is not installed)"
    environment = claude_environment()
    environment["PATH"] = CLAUDE_CODE_PATH
    environment.pop("CLAUDE_CONFIG_DIR", None)
    if config_dir:
        environment["CLAUDE_CONFIG_DIR"] = os.path.expanduser(config_dir)
    workdir = tempfile.mkdtemp(prefix="wat2do-maintenance-probe-")
    try:
        result = subprocess.run(
            [
                executable,
                "-p",
                "--model",
                context.control.probe_model,
                "--tools",
                "",
                "--strict-mcp-config",
                "--no-session-persistence",
                "--output-format",
                "json",
            ],
            input="Reply with the single word ok.",
            cwd=workdir,
            env=environment,
            capture_output=True,
            text=True,
            timeout=context.control.probe_timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return "failing (no answer in time)"
    finally:
        remove_run_folder(workdir)
        shutil.rmtree(workdir, ignore_errors=True)
    try:
        printed = json.loads(result.stdout)
    except ValueError:
        printed = {}
    words = f"{printed.get('result') or ''} {result.stderr[-300:]}"
    if printed.get("api_error_status") == 429:
        return f"limited ({printed.get('result') or 'usage limit'})"
    if "not logged in" in words.lower() or "/login" in words:
        return "logged out"
    if result.returncode or printed.get("is_error"):
        return f"failing (exit {result.returncode})"
    return "ok"


def claude_logins(context: Context) -> dict[str, str]:
    return {
        "main (~/.claude, ingestion)": _probe(None, context),
        f"second ({context.control.claude_config_dir})": _probe(
            context.control.claude_config_dir, context
        ),
    }
