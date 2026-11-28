"""The watchdog's thresholds: each judge against hand-made readings."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from core.controlbox import controlbox
from services.maintenance import judges, readings

CONTROL = controlbox.maintenance.model_copy(
    update={
        "ingestion_window_hours": 6,
        "ingestion_window_min_ratio": 0.25,
        "ingestion_window_min_baseline": 150,
        "ingestion_day_min_ratio": 0.4,
        "ingestion_silence_minutes": 120,
        "school_dark_min_baseline": 40,
        "school_dark_ratio": 0.1,
        "school_low_ratio": 0.25,
        "school_digest_hours": 26,
        "brave_heartbeat_max_seconds": 600,
        "brave_window_hours": 3,
        "brave_job_failure_ratio": 0.3,
        "brave_job_min_jobs": 5,
        "brave_error_lines_per_hour": 60,
        "following_errors_per_account_hour": 4,
        "recorder_silence_minutes": 90,
        "recorder_user_silence_hours": 14,
        "digest_silence_hours": 30,
        "account_silence_hours": 24,
        "account_silence_excluded": (),
        "dispatch_waiting_max": 20,
        "workflow_window_hours": 6,
        "workflow_failure_ratio": 0.25,
        "workflow_min_runs": 4,
        "queued_run_max_minutes": 45,
        "notification_agent_error_ratio": 0.3,
        "notification_agent_min_reports": 4,
        "runners": ("mac", "scraper"),
        "emulator_restarts_per_day": 6,
        "qemu_cpu_percent": 300,
        "disk_free_gb_yellow": 20,
        "disk_free_gb_red": 10,
        "swap_used_gb_red": 12,
        "keep_alive_agents": ("io.wat2do.worker",),
        "scheduled_agents": ("io.wat2do.timer",),
        "retry_log_max_minutes": 30,
        "sittings_check_hour": 13,
        "carousels_check_hour": 12,
        "trigger_debounce_hours": 2,
        "triggered_runs_per_day": 4,
    }
)
NOW = datetime(2026, 11, 26, 22, 0, tzinfo=timezone.utc)


def _ingestion(**changes):
    reading = {
        "window_now": 400,
        "window_baseline": [500, 300, 450, 600, 380, 420, 410],
        "day_now": 2000,
        "day_baseline": [2100, 1900, 2200, 1800, 2000, 2300, 2050],
        "last_item_minutes": 3,
        "no_digest": [],
        "schools": {
            "uwaterloo": {"today": 60, "baseline": [62, 60, 64, 58, 61, 66, 59]},
            "yorku": {"today": 70, "baseline": [72] * 7},
            "berkeley": {"today": 0, "baseline": [6] * 7},
        },
    }
    reading.update(changes)
    return judges.ingestion(reading, CONTROL)


def test_ingestion_at_its_usual_volume_is_green():
    assert _ingestion().status == "green"


def test_ingestion_far_under_the_same_hours_last_week_is_red():
    # 2026-11-26: 80-450 items an hour fell to 10-30.
    check = _ingestion(window_now=90)
    assert check.status == "red"
    assert "90 Instagram items in the last 6 h" in check.summary


def test_a_quiet_window_with_a_small_baseline_is_not_an_outage():
    check = _ingestion(window_now=10, window_baseline=[40, 20, 60, 30, 50, 10, 25])
    assert check.status == "green"


def test_a_day_under_its_ratio_of_the_usual_day_is_red():
    assert _ingestion(day_now=700).status == "red"


def test_no_item_for_too_long_is_red():
    assert _ingestion(last_item_minutes=180).status == "red"
    assert _ingestion(last_item_minutes=None).status == "red"


def test_one_school_far_under_its_own_median_is_red():
    # 2026-11-26: uwaterloo got 2 items in a day against its usual 60-96.
    check = _ingestion(
        schools={
            "uwaterloo": {"today": 2, "baseline": [60] * 7},
            "yorku": {"today": 70, "baseline": [72] * 7},
        }
    )
    assert check.status == "red"
    assert "uwaterloo 2 (median 60)" in check.summary


def test_a_school_without_a_digest_is_red_only_when_the_quiet_lane_misses_it_too():
    low = {"uwaterloo": {"today": 12, "baseline": [60] * 7}}
    assert _ingestion(schools=low).status == "green"
    check = _ingestion(schools=low, no_digest=["uwaterloo"])
    assert check.status == "red"
    assert "no daily digest for 26 h" in check.summary
    covered = {"uwaterloo": {"today": 40, "baseline": [60] * 7}}
    assert _ingestion(schools=covered, no_digest=["uwaterloo"]).status == "green"


def test_a_school_with_a_small_baseline_is_never_dark():
    check = _ingestion(
        schools={
            "berkeley": {"today": 0, "baseline": [6] * 7},
            "mit": {"today": 0, "baseline": [19] * 7},
        }
    )
    assert check.status == "green"


def _brave(**changes):
    reading = {
        "status": {"paused": False, "accounts_paused": {}, "accounts_missing": {}},
        "heartbeat_age_seconds": 5,
        "jobs": {"digest": {"succeeded": 20, "failed": 1}, "engagement": {"succeeded": 30}},
        "error_lines": 10,
        "log_hours": 1.0,
    }
    reading.update(changes)
    return judges.brave(reading, CONTROL)


def test_a_healthy_brave_worker_is_green():
    assert _brave().status == "green"


def test_an_account_refused_again_and_again_in_an_hour_is_red():
    quiet = judges.following_guard(
        {"refusals_last_hour": {"wat2do.mun": 1}, "tripped": {}}, CONTROL
    )
    assert quiet.status == "green"
    hammered = judges.following_guard(
        {"refusals_last_hour": {"wat2do.sfu": 4, "wat2do.mun": 3}, "tripped": {}}, CONTROL
    )
    assert hammered.status == "red"
    assert hammered.problems == ["wat2do.sfu: 4 refused Following reads in the last hour"]


def test_an_open_breaker_waits_for_a_person_as_yellow():
    check = judges.following_guard(
        {"refusals_last_hour": {}, "tripped": {"wat2do.sfu": "Instagram ended the login"}},
        CONTROL,
    )
    assert check.status == "yellow"
    assert "wat2do.sfu's breaker is open" in check.summary


def test_following_refusals_are_counted_per_account_from_the_log_and_the_guard(
    tmp_path, monkeypatch
):
    import json
    import sqlite3

    monkeypatch.setattr(readings, "BROWSER_STATE", tmp_path)
    log = tmp_path / "worker.stderr.log"
    log.write_text("")
    with sqlite3.connect(tmp_path / "jobs.sqlite3") as db:
        db.execute("create table settings (key text primary key, value text)")
        guard = {
            "refusal_times": [NOW.timestamp() - 60, NOW.timestamp() - 7200],
            "tripped_at": None,
        }
        tripped = {
            "refusal_times": [],
            "tripped_at": 1.0,
            "tripped_reason": "Instagram ended the login",
        }
        db.execute(
            "insert into settings values (?, ?)", ("account_guard:wat2do.udem", json.dumps(guard))
        )
        db.execute(
            "insert into settings values (?, ?)", ("account_guard:wat2do.sfu", json.dumps(tripped))
        )
    context = readings.Context(CONTROL, {}, NOW)
    readings.following_guard(context)  # the first pass only marks where the log ends
    line = "WARNING wat2do::lightpanda::lane: Lightpanda job {} failed for wat2do.sfu: {}\n"
    with log.open("a") as handle:
        handle.write(line.format("a1", "Instagram Following response was not valid JSON"))
        handle.write(line.format("a2", "Instagram Following read failed with HTTP 429"))
        handle.write(line.format("a3", "Lightpanda did not start in time"))
    later = readings.Context(CONTROL, context.state, NOW + timedelta(minutes=30))

    reading = readings.following_guard(later)

    assert reading == {
        "refusals_last_hour": {"wat2do.sfu": 2, "wat2do.udem": 1},
        "tripped": {"wat2do.sfu": "Instagram ended the login"},
    }
    # The brave check in the same pass reads the same new lines.
    assert later.new_log_text(log)[0].count("failed for wat2do.sfu") == 3


def test_a_paused_or_silent_brave_worker_is_red():
    assert _brave(status={"paused": "log in to Instagram in Brave"}).status == "red"
    assert _brave(heartbeat_age_seconds=900).status == "red"
    assert _brave(heartbeat_age_seconds=None).status == "red"


def test_failing_digests_are_red_and_failing_engagement_yellow():
    assert _brave(jobs={"digest": {"succeeded": 3, "failed": 4}}).status == "red"
    assert _brave(jobs={"digest": {"succeeded": 3, "cancelled": 4}}).status == "red"
    assert _brave(jobs={"engagement": {"succeeded": 3, "failed": 4}}).status == "yellow"


def test_too_few_jobs_never_judge_a_failure_rate():
    assert _brave(jobs={"digest": {"succeeded": 1, "failed": 3}}).status == "green"


def test_held_accounts_are_yellow():
    check = _brave(
        status={"paused": False, "accounts_paused": {"wat2do.sfu": "x"}, "accounts_missing": {}}
    )
    assert check.status == "yellow"
    assert "wat2do.sfu" in check.summary


def test_a_burst_of_worker_errors_is_red():
    assert _brave(error_lines=200, log_hours=1.0).status == "red"
    assert _brave(error_lines=200, log_hours=4.0).status == "green"
    assert _brave(error_lines=200, log_hours=0.0).status == "green"


def _recorder(**changes):
    reading = {
        "last_any_minutes": 2,
        "awake_silence_minutes": 2,
        "user_hours": {"0": 0.1, "10": 1.5, "11": 3.0, "12": 0.5},
        "expected_users": [0, 10, 11, 12],
        "digest_hours": 20,
        "dispatch_waiting": 0,
    }
    reading.update(changes)
    return judges.recorder(reading, CONTROL)


def test_a_recorder_hearing_every_user_is_green():
    assert _recorder().status == "green"


def test_a_silent_recorder_or_android_user_is_red():
    assert _recorder(last_any_minutes=120, awake_silence_minutes=120).status == "red"
    assert _recorder(last_any_minutes=None, awake_silence_minutes=None).status == "red"
    check = _recorder(user_hours={"0": 0.1, "10": 1.5, "11": 15.0, "12": 0.5})
    assert check.status == "red"
    assert "Android user 11" in check.summary
    assert _recorder(user_hours={"0": 0.1, "10": 1.5, "11": 3.0}).status == "red"


def test_a_recorder_silent_only_through_the_night_is_green():
    assert _recorder(last_any_minutes=280, awake_silence_minutes=10).status == "green"


def _accounts(**changes):
    reading = {
        "accounts": {
            "wat2do.utsg": {"android_user": 12, "hours": 2.0},
            "wat2do.mit": {"android_user": 12, "hours": 23.0},
            "wat2do.yorku": {"android_user": 0, "hours": 0.2},
        },
        "waiting": {},
    }
    reading.update(changes)
    return judges.account_notifications(reading, CONTROL)


def test_every_account_heard_within_a_day_is_green():
    assert _accounts().status == "green"


def test_one_silent_account_is_red_while_its_android_user_is_not():
    accounts = {
        "wat2do.utsg": {"android_user": 12, "hours": 2.0},
        "wat2do.berkeley": {"android_user": 12, "hours": None},
        "wat2do.mit": {"android_user": 12, "hours": 37.0},
    }
    check = _accounts(accounts=accounts)
    assert check.status == "red"
    assert "wat2do.berkeley (Android user 12) recorded nothing in the recorder's log" in (
        check.problems
    )
    assert "wat2do.mit (Android user 12) recorded nothing for 37 h" in check.problems
    assert not any("utsg" in problem for problem in check.problems)


def test_a_silent_account_waiting_on_tony_is_only_yellow():
    accounts = {"wat2do.sfu": {"android_user": 11, "hours": 60.0}}
    check = _accounts(accounts=accounts, waiting={"wat2do.sfu": "Instagram challenge"})
    assert check.status == "yellow"
    assert "waiting: Instagram challenge" in check.summary


def test_account_readings_skip_excluded_and_expired_waits(tmp_path, monkeypatch):
    import json

    log = tmp_path / "notification-log"
    log.mkdir()
    lines = [
        {"recorded_at": (NOW - timedelta(hours=30)).isoformat(), "account": "wat2do.mit"},
        {"recorded_at": (NOW - timedelta(hours=1)).isoformat(), "account": "wat2do.utsg"},
    ]
    # The newest lines sit in a rotated file: the current one was just started.
    (log / "notifications.jsonl.1").write_text(
        "".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8"
    )
    (log / "notifications.jsonl").write_text("", encoding="utf-8")
    waits = tmp_path / "account_waits.json"
    waits.write_text(
        json.dumps(
            {
                "wat2do.mit": {"reason": "old", "until": (NOW - timedelta(hours=1)).isoformat()},
                "wat2do.sfu": {
                    "reason": "challenge",
                    "until": (NOW + timedelta(hours=5)).isoformat(),
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(readings, "NOTIFICATION_LOG", log)
    monkeypatch.setattr(readings, "ACCOUNT_WAITS", waits)
    emulator = controlbox.instagram_emulator.model_copy(
        update={"android_user_by_school": {"mit": 12, "utsg": 12, "sfu": 11, "upenn": 11}}
    )
    monkeypatch.setattr(readings, "controlbox", SimpleNamespace(instagram_emulator=emulator))
    control = CONTROL.model_copy(update={"account_silence_excluded": ("wat2do.upenn",)})

    reading = readings.account_notifications(readings.Context(control, {}, NOW))

    assert reading["accounts"]["wat2do.mit"] == {"android_user": 12, "hours": 30.0}
    assert reading["accounts"]["wat2do.utsg"]["hours"] == 1.0
    assert reading["accounts"]["wat2do.sfu"]["hours"] is None
    assert "wat2do.upenn" not in reading["accounts"]
    assert reading["waiting"] == {"wat2do.sfu": "challenge"}


def test_night_silence_does_not_count():
    def at(day: int, hour: int, minute: int = 0) -> datetime:
        return datetime(2026, 11, day, hour, minute, tzinfo=readings.TORONTO)

    # 22:53 to 03:41: only the 67 minutes before midnight count.
    assert readings.awake_minutes(at(26, 22, 53), at(27, 3, 41), 8) == 67
    # 02:06 to 09:41: only the 101 minutes after 8:00 count.
    assert readings.awake_minutes(at(14, 2, 6), at(14, 9, 41), 8) == 101
    # A two-day outage loses each night's 8 hours.
    assert readings.awake_minutes(at(17, 12), at(19, 12), 8) == (48 - 16) * 60
    # Daytime silence counts in full.
    assert readings.awake_minutes(at(21, 13, 28), at(21, 15), 8) == 92
    # The fall-back night is 9 elapsed hours, all of them quiet.
    assert readings.awake_minutes(at(1, 0), at(1, 8), 8) == 0


def test_no_digest_for_too_long_is_red():
    assert _recorder(digest_hours=31).status == "red"
    assert _recorder(digest_hours=None).status == "red"


def test_waiting_dispatches_are_yellow_then_red():
    assert _recorder(dispatch_waiting=3).status == "yellow"
    assert _recorder(dispatch_waiting=25).status == "red"


def _run(status="completed", conclusion="success", minutes_ago=10):
    return {"status": status, "conclusion": conclusion, "minutes_ago": minutes_ago}


def test_handle_notification_failures_over_the_ratio_are_red():
    healthy = [_run() for _ in range(9)] + [_run(conclusion="failure")]
    assert judges.workflow({"runs": healthy}, CONTROL).status == "green"
    failing = [_run() for _ in range(6)] + [_run(conclusion="failure") for _ in range(4)]
    assert judges.workflow({"runs": failing}, CONTROL).status == "red"


def test_cancelled_and_old_runs_do_not_count():
    runs = (
        [_run(conclusion="cancelled") for _ in range(5)]
        + [_run(conclusion="failure", minutes_ago=600) for _ in range(5)]
        + [_run()]
    )
    assert judges.workflow({"runs": runs}, CONTROL).status == "green"


def test_a_run_stuck_in_the_queue_is_red():
    assert (
        judges.workflow(
            {"runs": [_run(status="queued", conclusion=None, minutes_ago=60)]}, CONTROL
        ).status
        == "red"
    )
    assert (
        judges.workflow(
            {"runs": [_run(status="queued", conclusion=None, minutes_ago=5)]}, CONTROL
        ).status
        == "green"
    )


def test_notification_agent_errors_over_the_ratio_are_red():
    assert judges.notification_agent({"reports": 10, "errors": 2}, CONTROL).status == "green"
    assert judges.notification_agent({"reports": 10, "errors": 4}, CONTROL).status == "red"
    assert judges.notification_agent({"reports": 3, "errors": 3}, CONTROL).status == "green"


def test_an_offline_or_missing_runner_is_red():
    assert judges.runners({"mac": "online", "scraper": "online"}, CONTROL).status == "green"
    assert judges.runners({"mac": "online", "scraper": "offline"}, CONTROL).status == "red"
    assert judges.runners({"mac": "online"}, CONTROL).status == "red"


def _emulator(**changes):
    reading = {
        "adb_state": "device",
        "missing_logins": [],
        "qemu_cpu_percent": 80.0,
        "restarts_24h": 0,
    }
    reading.update(changes)
    return judges.emulator(reading, CONTROL)


def test_emulator_checks():
    assert _emulator().status == "green"
    assert _emulator(adb_state="offline").status == "red"
    check = _emulator(missing_logins=["wat2do.mcgill"])
    assert check.status == "red"
    assert "wat2do.mcgill" in check.summary
    waiting = _emulator(waiting_logins={"wat2do.sfu": "checkpoint, Tony must clear it"})
    assert waiting.status == "yellow"
    assert "wat2do.sfu" in waiting.summary
    assert _emulator(restarts_24h=2).status == "yellow"
    assert _emulator(restarts_24h=7).status == "red"
    assert _emulator(qemu_cpu_percent=520.0).status == "yellow"
    assert _emulator(qemu_cpu_percent=None).status == "green"


def test_disk_and_swap_thresholds():
    assert judges.host({"disk_free_gb": 40, "swap_used_gb": 6}, CONTROL).status == "green"
    assert judges.host({"disk_free_gb": 15, "swap_used_gb": 6}, CONTROL).status == "yellow"
    assert judges.host({"disk_free_gb": 8, "swap_used_gb": 6}, CONTROL).status == "red"
    assert judges.host({"disk_free_gb": 40, "swap_used_gb": 13}, CONTROL).status == "red"


def _agents(worker=None, timer=None, retry_minutes=5, blocked=None):
    return judges.launch_agents(
        {
            "agents": {
                "io.wat2do.worker": worker or {"loaded": True, "pid": 10, "last_exit": None},
                "io.wat2do.timer": timer or {"loaded": True, "pid": None, "last_exit": 0},
            },
            "retry_log_minutes": retry_minutes,
            "retry_blocked": blocked,
        },
        CONTROL,
    )


def test_launch_agents():
    assert _agents().status == "green"
    assert _agents(worker={"loaded": True, "pid": None, "last_exit": -15}).status == "red"
    assert _agents(worker={"loaded": False, "pid": None, "last_exit": None}).status == "red"
    assert _agents(timer={"loaded": False, "pid": None, "last_exit": None}).status == "red"
    assert _agents(timer={"loaded": True, "pid": None, "last_exit": 1}).status == "yellow"
    assert _agents(retry_minutes=45).status == "red"
    assert _agents(blocked="the Instagram browser worker is paused").status == "red"


def test_sittings_are_judged_only_after_their_hour():
    assert judges.sittings({"hour": 10, "sat": [], "failed_moves": 0}, CONTROL).status == "green"
    assert judges.sittings({"hour": 14, "sat": [], "failed_moves": 0}, CONTROL).status == "red"
    assert (
        judges.sittings({"hour": 14, "sat": ["tmu"], "failed_moves": 3}, CONTROL).status == "yellow"
    )


def _carousels(**changes):
    reading = {
        "hour": 15,
        "statuses": {"published": 20, "empty": 3},
        "failures": [],
        "music_failed": 0,
        "story_failed": 0,
    }
    reading.update(changes)
    return judges.carousels(reading, CONTROL)


def test_carousels():
    assert _carousels().status == "green"
    assert _carousels(statuses={"ready_for_review": 20}).status == "red"
    assert _carousels(hour=10, statuses={"ready_for_review": 20}).status == "green"
    failed = _carousels(
        failures=[{"school": "brocku", "error": "Server error 500 rendering a slide"}]
    )
    assert failed.status == "red"
    assert "brocku" in failed.summary
    assert _carousels(music_failed=1).status == "yellow"


def test_a_carousel_failing_on_its_token_is_left_to_the_token_check():
    token = {
        "school": "mcgill",
        "error": "Error validating access token: The session has been invalidated",
    }
    assert _carousels(failures=[token]).status == "green"


def _follows(**changes):
    reading = {
        "unsynced": [],
        "unsynced_count": 0,
        "gone": [],
        "gone_count": 0,
        "claimed_not_followed": [],
        "unfollow_count": 0,
        "backlog_count": 0,
    }
    reading.update(changes)
    return judges.follows(reading, CONTROL)


def test_follows():
    assert _follows().status == "green"
    unsynced = _follows(unsynced=["carleton @afghanstudents_carleton"], unsynced_count=1)
    assert unsynced.status == "red"
    assert "afghanstudents_carleton" in unsynced.summary
    assert _follows(claimed_not_followed=["uwo @club (rejected)"]).status == "red"
    assert _follows(gone=["columbia @columbiaubadminton"], gone_count=236).status == "yellow"
    assert _follows(unfollow_count=14).status == "yellow"
    assert _follows(backlog_count=3).status == "yellow"
    waiting = _follows(claimed_waiting={"uwo @club (rejected)": "club blocked wat2do.uwo"})
    assert waiting.status == "yellow"
    assert "club blocked wat2do.uwo" in waiting.summary


def test_a_claimed_club_in_account_waits_is_waiting_not_red(tmp_path, monkeypatch):
    import json

    waits = tmp_path / "account_waits.json"
    waits.write_text(
        json.dumps(
            {
                "uwo @club": {"reason": "blocked", "until": (NOW + timedelta(hours=5)).isoformat()},
                "uwo @old": {"reason": "old", "until": (NOW - timedelta(hours=1)).isoformat()},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(readings, "ACCOUNT_WAITS", waits)
    rows = {"follows": {"claimed_not_followed": ["uwo @club (rejected)", "uwo @old (unfollow)"]}}

    reading = readings.follows(rows, readings.Context(CONTROL, {}, NOW))

    assert reading["claimed_not_followed"] == ["uwo @old (unfollow)"]
    assert reading["claimed_waiting"] == {"uwo @club (rejected)": "blocked"}


def test_token_problems_are_red_but_never_start_the_agent():
    check = judges.graph_tokens(
        {
            "token_problems": [{"account": "mcgill", "problem": "token invalid"}],
            "stale_snapshots": [],
        },
        CONTROL,
    )
    assert check.status == "red"
    assert not check.triggers
    assert judges.due_triggers([check], {}, 0, NOW, CONTROL) == []


def test_claude_logins():
    assert judges.claude_logins({"main": "ok", "second": "ok"}, CONTROL).status == "green"
    check = judges.claude_logins({"main": "limited (resets 5am)", "second": "ok"}, CONTROL)
    assert check.status == "red"
    assert "main" in check.summary


def test_worst_and_unreadable():
    checks = [judges.verdict("a", []), judges.unreadable("b", "TimeoutExpired")]
    assert judges.worst(checks) == "yellow"
    assert judges.worst([*checks, judges.verdict("c", ["down"])]) == "red"
    assert judges.worst([]) == "green"


def test_a_red_check_starts_the_agent_at_most_once_per_debounce_window():
    red = judges.verdict("brave", ["worker paused"])
    green = judges.verdict("host", [])
    assert judges.due_triggers([red, green], {}, 0, NOW, CONTROL) == ["brave"]
    recent = {"brave": (NOW - timedelta(minutes=90)).isoformat()}
    assert judges.due_triggers([red], recent, 1, NOW, CONTROL) == []
    old = {"brave": (NOW - timedelta(hours=2)).isoformat()}
    assert judges.due_triggers([red], old, 1, NOW, CONTROL) == ["brave"]


def test_no_early_run_once_the_days_extra_runs_are_spent():
    red = judges.verdict("brave", ["worker paused"])
    assert judges.due_triggers([red], {}, 4, NOW, CONTROL) == []
