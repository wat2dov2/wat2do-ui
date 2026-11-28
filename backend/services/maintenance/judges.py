"""The watchdog's verdicts: hard numbers against `controlbox/maintenance.json`.

Each judge takes one reading (plain numbers and lists, gathered by `readings.py`) and
returns a `Check`. Nothing here reads a file, a database or the clock, so every
threshold is tested on its own.
"""

from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any, Literal

from core.controlbox import MaintenanceControl

Status = Literal["green", "yellow", "red"]
_RANK = {"green": 0, "yellow": 1, "red": 2}
_TOKEN_ERROR = "access token"


@dataclass(frozen=True)
class Check:
    name: str
    status: Status
    summary: str
    problems: list[str] = field(default_factory=list)
    # False for a check only a person can clear (a new Graph token): it waits for the
    # daily run's report instead of starting the agent early again and again.
    triggers: bool = True

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def verdict(name: str, red: list[str], yellow: list[str] | None = None, ok: str = "ok") -> Check:
    """Red when any red problem, else yellow when any yellow one, else green."""
    yellow = yellow or []
    if red:
        return Check(name, "red", "; ".join(red), red + yellow)
    if yellow:
        return Check(name, "yellow", "; ".join(yellow), yellow)
    return Check(name, "green", ok)


def unreadable(name: str, error: str) -> Check:
    """A reading that failed is worth a look, but is not proof of an outage."""
    return Check(name, "yellow", f"could not read: {error}", [f"could not read: {error}"])


def worst(checks: list[Check]) -> Status:
    return max((check.status for check in checks), key=_RANK.__getitem__, default="green")


def _median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def ingestion(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """Instagram posts reaching `ingestion_items`, against the same hours on earlier days."""
    red: list[str] = []
    yellow: list[str] = []
    window = reading["window_now"]
    window_baseline = _median(reading["window_baseline"])
    if (
        window_baseline >= control.ingestion_window_min_baseline
        and window < control.ingestion_window_min_ratio * window_baseline
    ):
        red.append(
            f"{window} Instagram items in the last {control.ingestion_window_hours} h, "
            f"median {window_baseline:g} for the same hours on the last {control.baseline_days} days"
        )
    day_baseline = _median(reading["day_baseline"])
    if day_baseline and reading["day_now"] < control.ingestion_day_min_ratio * day_baseline:
        red.append(f"{reading['day_now']} items in the last 24 h, median {day_baseline:g}")
    silence = reading["last_item_minutes"]
    if silence is None or silence > control.ingestion_silence_minutes:
        red.append(
            "no Instagram item ever"
            if silence is None
            else f"no Instagram item for {silence:.0f} min"
        )
    # 2026-11-26: uwaterloo got 2 items in a day against its usual 60-96.
    dark: list[str] = []
    uncovered: list[str] = []
    for school, counts in sorted(reading["schools"].items()):
        baseline = _median(counts["baseline"])
        if baseline < control.school_dark_min_baseline:
            continue
        line = f"{school} {counts['today']} (median {baseline:g})"
        if counts["today"] < control.school_dark_ratio * baseline:
            dark.append(line)
        elif (
            school in reading["no_digest"] and counts["today"] < control.school_low_ratio * baseline
        ):
            uncovered.append(line)
    if dark:
        red.append(f"nearly dark in the last 24 h: {', '.join(dark)}")
    if uncovered:
        red.append(
            f"no daily digest for {control.school_digest_hours} h and few items "
            f"(the quiet-school lane is not covering them): {', '.join(uncovered)}"
        )
    return verdict(
        "ingestion",
        red,
        yellow,
        f"{window} items in the last {control.ingestion_window_hours} h "
        f"(median {window_baseline:g}), {reading['day_now']} in 24 h (median {day_baseline:g})",
    )


def brave(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """The Brave worker: running, not paused, its digests and reads mostly succeeding."""
    red: list[str] = []
    yellow: list[str] = []
    status = reading["status"]
    if status.get("paused"):
        red.append(f"worker paused: {status['paused']}")
    heartbeat = reading["heartbeat_age_seconds"]
    if heartbeat is None or heartbeat > control.brave_heartbeat_max_seconds:
        red.append(
            "worker has no heartbeat"
            if heartbeat is None
            else f"worker heartbeat {heartbeat:.0f} s old"
        )
    held = sorted({*status.get("accounts_paused", {}), *status.get("accounts_missing", {})})
    if held:
        yellow.append(f"accounts held or missing in Brave: {', '.join(held)}")
    for kind, states in sorted(reading["jobs"].items()):
        finished = sum(states.get(state, 0) for state in ("succeeded", "failed", "cancelled"))
        bad = states.get("failed", 0) + states.get("cancelled", 0)
        if (
            finished >= control.brave_job_min_jobs
            and bad > control.brave_job_failure_ratio * finished
        ):
            problem = (
                f"{bad} of {finished} {kind} jobs failed or were cancelled in the last "
                f"{control.brave_window_hours} h"
            )
            (red if kind in ("digest", "retrieval") else yellow).append(problem)
    hours = reading["log_hours"]
    if hours and reading["error_lines"] / hours > control.brave_error_lines_per_hour:
        red.append(f"{reading['error_lines']} ERROR lines in the worker log in {hours:.1f} h")
    digests = reading["jobs"].get("digest", {}).get("succeeded", 0)
    return verdict(
        "brave", red, yellow, f"running, {digests} digests read in {control.brave_window_hours} h"
    )


def following_guard(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """No account keeps reading Following lists while Instagram refuses it: refusals per
    account per hour at the threshold are red. An open breaker waits for a person (to
    clear the checkpoint, then `wat2do-browser account-guard --account <a> --reset`),
    so it is yellow and never starts the agent."""
    red = [
        f"{account}: {count} refused Following reads in the last hour"
        for account, count in sorted(reading["refusals_last_hour"].items())
        if count >= control.following_errors_per_account_hour
    ]
    yellow = [
        f"{account}'s breaker is open (no automated traffic): {reason}"
        for account, reason in sorted(reading["tripped"].items())
    ]
    return verdict("following_guard", red, yellow)


def ingestion_processor(reading: dict[str, Any], _control: MaintenanceControl) -> Check:
    """The always-on processor: alive, and not turned away by Claude's usage limit."""
    red: list[str] = []
    if not reading["running"]:
        red.append("io.wat2do.ingestion.process has no process")
    if reading["limit_lines"]:
        red.append(
            f"{reading['limit_lines']} usage-limit lines in process.stderr.log since the last check"
        )
    return verdict("ingestion_processor", red)


def recorder(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """The emulator's notification recorder: hearing every Android user, and dispatching."""
    red: list[str] = []
    yellow: list[str] = []
    last = reading["last_any_minutes"]
    if last is None or reading["awake_silence_minutes"] > control.recorder_silence_minutes:
        red.append(
            "nothing recorded ever" if last is None else f"nothing recorded for {last:.0f} min"
        )
    for user in reading["expected_users"]:
        hours = reading["user_hours"].get(str(user))
        if hours is None or hours > control.recorder_user_silence_hours:
            red.append(
                f"Android user {user} recorded nothing"
                + ("" if hours is None else f" for {hours:.1f} h")
            )
    digest = reading["digest_hours"]
    if digest is None or digest > control.digest_silence_hours:
        red.append(
            "no daily digest notification recorded"
            + ("" if digest is None else f" for {digest:.1f} h")
        )
    if reading["dispatch_waiting"] > control.dispatch_waiting_max:
        red.append(f"{reading['dispatch_waiting']} dispatches waiting to start the workflow")
    elif reading["dispatch_waiting"]:
        yellow.append(f"{reading['dispatch_waiting']} dispatches waiting")
    return verdict(
        "recorder",
        red,
        yellow,
        f"last notification {last:.0f} min ago" if last is not None else "ok",
    )


def account_notifications(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """Every school account on the emulator hearing from Instagram: a logged-out account,
    one whose pushes stopped or one with no post bells gets nothing at all, while the
    rest of its Android user keeps the recorder check green."""
    red: list[str] = []
    yellow: list[str] = []
    for account, seen in reading["accounts"].items():
        hours = seen["hours"]
        if hours is not None and hours <= control.account_silence_hours:
            continue
        silence = f"{account} (Android user {seen['android_user']}) recorded nothing" + (
            " in the recorder's log" if hours is None else f" for {hours:.0f} h"
        )
        if account in reading["waiting"]:
            yellow.append(f"{silence}, waiting: {reading['waiting'][account]}")
        else:
            red.append(silence)
    return verdict(
        "account_notifications",
        red,
        yellow,
        f"all {len(reading['accounts'])} accounts heard within {control.account_silence_hours} h",
    )


def workflow(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """The "Handle notification" workflow: few failures, nothing stuck in the queue."""
    red: list[str] = []
    runs = [
        run for run in reading["runs"] if run["minutes_ago"] <= control.workflow_window_hours * 60
    ]
    done = [
        run for run in runs if run["status"] == "completed" and run["conclusion"] != "cancelled"
    ]
    failed = [run for run in done if run["conclusion"] != "success"]
    if len(done) >= control.workflow_min_runs and len(
        failed
    ) > control.workflow_failure_ratio * len(done):
        red.append(
            f"{len(failed)} of {len(done)} Handle notification runs failed in {control.workflow_window_hours} h"
        )
    stuck = [
        run
        for run in reading["runs"]
        if run["status"] in ("queued", "waiting", "pending")
        and run["minutes_ago"] > control.queued_run_max_minutes
    ]
    if stuck:
        red.append(f"{len(stuck)} runs queued over {control.queued_run_max_minutes} min")
    return verdict(
        "workflow",
        red,
        ok=f"{len(done) - len(failed)} of {len(done)} runs succeeded in {control.workflow_window_hours} h",
    )


def notification_agent(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """The notification agent's own reports: how many runs ended in an error."""
    red: list[str] = []
    reports, errors = reading["reports"], reading["errors"]
    if (
        reports >= control.notification_agent_min_reports
        and errors > control.notification_agent_error_ratio * reports
    ):
        red.append(
            f"{errors} of {reports} notification agent runs ended in an error in {control.workflow_window_hours} h"
        )
    return verdict("notification_agent", red, ok=f"{reports - errors} of {reports} runs handled")


def runners(reading: dict[str, str], control: MaintenanceControl) -> Check:
    offline = [name for name in control.runners if reading.get(name) != "online"]
    return verdict(
        "runners", [f"runner {name} is {reading.get(name, 'missing')}" for name in offline]
    )


def emulator(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    red: list[str] = []
    yellow: list[str] = []
    if reading["adb_state"] != "device":
        red.append(f"emulator not answering adb ({reading['adb_state']})")
    if reading["missing_logins"]:
        red.append(
            f"accounts not logged in on the emulator: {', '.join(reading['missing_logins'])}"
        )
    if reading["restarts_24h"] > control.emulator_restarts_per_day:
        red.append(f"emulator restarted {reading['restarts_24h']} times in 24 h")
    elif reading["restarts_24h"]:
        yellow.append(f"emulator restarted {reading['restarts_24h']} times in 24 h")
    cpu = reading["qemu_cpu_percent"]
    if cpu is not None and cpu >= control.qemu_cpu_percent:
        yellow.append(f"qemu at {cpu:.0f}% CPU (render threads may be spinning)")
    return verdict("emulator", red, yellow)


def host(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    red: list[str] = []
    yellow: list[str] = []
    free = reading["disk_free_gb"]
    if free < control.disk_free_gb_red:
        red.append(f"only {free:.1f} GB free on disk")
    elif free < control.disk_free_gb_yellow:
        yellow.append(f"{free:.1f} GB free on disk")
    if reading["swap_used_gb"] > control.swap_used_gb_red:
        red.append(f"{reading['swap_used_gb']:.1f} GB of swap in use")
    return verdict(
        "host", red, yellow, f"{free:.0f} GB free, {reading['swap_used_gb']:.1f} GB swap"
    )


def launch_agents(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """Every always-on job has a process, every timer is loaded, the retry agent ran lately."""
    red: list[str] = []
    yellow: list[str] = []
    agents = reading["agents"]
    for label in control.keep_alive_agents:
        agent = agents.get(label)
        if not agent or not agent["loaded"]:
            red.append(f"{label} is not loaded")
        elif not agent["pid"]:
            red.append(f"{label} has no process (last exit {agent['last_exit']})")
    for label in control.scheduled_agents:
        agent = agents.get(label)
        if not agent or not agent["loaded"]:
            red.append(f"{label} is not loaded")
        elif agent["last_exit"] not in (None, 0) and not agent["pid"]:
            yellow.append(f"{label} last exited {agent['last_exit']}")
    retry = reading["retry_log_minutes"]
    if retry is None or retry > control.retry_log_max_minutes:
        red.append(
            "the notification retry agent has not run"
            + ("" if retry is None else f" for {retry:.0f} min")
        )
    if reading["retry_blocked"]:
        red.append(f"the retry agent is blocked: {reading['retry_blocked']}")
    return verdict("launch_agents", red, yellow)


def sittings(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    red: list[str] = []
    yellow: list[str] = []
    if reading["hour"] >= control.sittings_check_hour and not reading["sat"]:
        red.append(f"no school has had its sitting today by {control.sittings_check_hour}:00")
    if reading["failed_moves"]:
        yellow.append(f"{reading['failed_moves']} sitting moves failed today")
    return verdict("sittings", red, yellow, f"{len(reading['sat'])} schools sat today")


def carousels(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """Today's carousels: posted, failed or skipped, and why."""
    red: list[str] = []
    yellow: list[str] = []
    statuses = reading["statuses"]
    if (
        reading["hour"] >= control.carousels_check_hour
        and statuses
        and not statuses.get("published")
    ):
        red.append("no carousel posted today")
    for failure in reading["failures"]:
        if _TOKEN_ERROR in failure["error"].lower():
            continue  # graph_tokens reports it, for a person
        red.append(f"{failure['school']} carousel failed: {failure['error']}")
    if reading["music_failed"]:
        yellow.append(f"{reading['music_failed']} posted carousels have no song")
    if reading["story_failed"]:
        yellow.append(f"{reading['story_failed']} posted carousels have no story")
    summary = (
        ", ".join(f"{count} {status}" for status, count in sorted(statuses.items()))
        or "no drafts today"
    )
    return verdict("carousels", red, yellow, summary)


def follows(reading: dict[str, Any], control: MaintenanceControl) -> Check:
    """Every approved club's Instagram account goes into the same follow queue as the
    crawl's finds (the worker's hourly club sync) and is followed from there."""
    red: list[str] = []
    yellow: list[str] = []
    if reading["unsynced_count"]:
        red.append(
            f"{reading['unsynced_count']} approved clubs not in the follow queue after "
            f"{control.follow_sync_hours} h (club sync stopped?): {', '.join(reading['unsynced'])}"
        )
    if reading["claimed_not_followed"]:
        red.append(
            "claimed clubs rejected or queued to unfollow: "
            + ", ".join(reading["claimed_not_followed"])
        )
    if reading["gone_count"]:
        yellow.append(
            f"{reading['gone_count']} approved clubs' accounts rejected as gone or hidden "
            f"(check a few on Instagram): {', '.join(reading['gone'])}"
        )
    if reading["unfollow_count"]:
        yellow.append(f"{reading['unfollow_count']} approved clubs' accounts queued to unfollow")
    if reading["backlog_count"]:
        yellow.append(
            f"{reading['backlog_count']} approved accounts still not followed after "
            f"{control.follow_backlog_days} days"
        )
    return verdict("follows", red, yellow, "every approved club is queued and followed")


def graph_tokens(reading: dict[str, Any], _control: MaintenanceControl) -> Check:
    """Graph posting tokens: only Tony can make a new one, so this never starts the agent."""
    red = [f"{row['account']}: {row['problem']}" for row in reading["token_problems"]]
    yellow = (
        [f"no stats snapshot lately for {', '.join(reading['stale_snapshots'])}"]
        if reading["stale_snapshots"]
        else []
    )
    return replace(verdict("graph_tokens", red, yellow), triggers=False)


def claude_logins(reading: dict[str, str], _control: MaintenanceControl) -> Check:
    return verdict(
        "claude_logins",
        [
            f"the {login} Claude login is {state}"
            for login, state in sorted(reading.items())
            if state != "ok"
        ],
    )


JUDGES = {
    "ingestion": ingestion,
    "brave": brave,
    "following_guard": following_guard,
    "ingestion_processor": ingestion_processor,
    "recorder": recorder,
    "account_notifications": account_notifications,
    "workflow": workflow,
    "notification_agent": notification_agent,
    "runners": runners,
    "emulator": emulator,
    "host": host,
    "launch_agents": launch_agents,
    "sittings": sittings,
    "carousels": carousels,
    "follows": follows,
    "graph_tokens": graph_tokens,
    "claude_logins": claude_logins,
}


def due_triggers(
    checks: list[Check],
    triggered: dict[str, str],
    runs_today: int,
    now: datetime,
    control: MaintenanceControl,
) -> list[str]:
    """The red checks that start the agent now: each at most once per debounce window,
    and none once today's extra runs are spent."""
    if runs_today >= control.triggered_runs_per_day:
        return []
    window = timedelta(hours=control.trigger_debounce_hours)
    return [
        check.name
        for check in checks
        if check.status == "red"
        and check.triggers
        and (
            check.name not in triggered
            or now - datetime.fromisoformat(triggered[check.name]) >= window
        )
    ]
