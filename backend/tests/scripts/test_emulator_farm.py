import fcntl
import json
import plistlib
import subprocess
from pathlib import Path

import pytest

from core.controlbox import EmulatorFarmNodeControl
from scripts import emulator_farm as script


def test_default_commands_are_bounded_without_dumping_command_output(monkeypatch):
    def timeout(command, **kwargs):
        assert kwargs["timeout"] == script.CONTROL.command_timeout_seconds
        raise subprocess.TimeoutExpired(command, kwargs["timeout"], output="private metadata")

    monkeypatch.setattr(script.subprocess, "run", timeout)
    with pytest.raises(script.FarmError, match="Command timed out") as failure:
        script._command(["adb", "devices"])
    assert "private metadata" not in str(failure.value)


@pytest.mark.parametrize(
    "payload", ["{truncated", "[]", '{"fingerprint": 1}', '{"fingerprint": "bad-time"}']
)
def test_corrupt_dispatch_ledger_is_preserved_and_blocks_dispatch(tmp_path, monkeypatch, payload):
    paths = _paths(tmp_path)
    paths.state_directory.mkdir()
    paths.dispatches.write_text(payload)
    monkeypatch.setattr(
        script,
        "_dispatch_notification",
        lambda *_args: pytest.fail("must not reset the dedupe ledger"),
    )
    with pytest.raises(script.FarmError, match="ledger"):
        script.dispatch_notifications(paths, script.CONTROL.nodes, {})
    assert paths.dispatches.read_text() == payload


def test_parallel_dispatcher_cannot_read_and_write_the_same_ledger(tmp_path):
    paths = _paths(tmp_path)
    paths.state_directory.mkdir()
    with (paths.state_directory / "dispatch.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(script.FarmError, match="still running"):
            script.dispatch_notifications(paths, script.CONTROL.nodes, {})


def test_failed_dispatch_does_not_block_another_school_or_record_failed_push(tmp_path, monkeypatch):
    paths = _paths(tmp_path)
    node = script.CONTROL.nodes[0]
    observed = tuple(
        script.NotificationEvidence(
            recipient_id=recipient,
            post_time_epoch_seconds=int(script.utc_now().timestamp()),
            push_id=f"private-push-{recipient}",
            push_category="post",
            instagram_action="clips_home?media_id=123",
            account_username="wat2do.account",
        )
        for recipient in ("11111111111", "22222222222")
    )
    calls = []
    monkeypatch.setattr(script, "_resolve_tool", lambda *_args: Path("gh"))

    def dispatch(_github, notification):
        recipient = notification[script.CONTROL.recipient_id_key]
        calls.append(recipient)
        if recipient == "11111111111":
            raise script.FarmError("GitHub is temporarily unavailable")

    monkeypatch.setattr(script, "_dispatch_notification", dispatch)
    result = script.dispatch_notifications(paths, (node,), {node.name: observed})
    assert calls == ["11111111111", "22222222222"]
    assert result["failed_count"] == 1
    assert result["failed_recipient_ids"] == ["11111111111"]
    assert result["dispatched_recipient_ids"] == ["22222222222"]
    ledger = script._read_dispatch_ledger(paths)
    assert script._notification_fingerprint(observed[0]) not in ledger
    assert script._notification_fingerprint(observed[1]) in ledger


def _paths(tmp_path: Path) -> script.FarmPaths:
    return script.FarmPaths(
        sdk_root=tmp_path / "sdk",
        avd_home=tmp_path / "avd",
        state_directory=tmp_path / "state",
        launch_agent_path=tmp_path / "LaunchAgents" / "farm.plist",
        python=Path("/usr/bin/python3"),
        script=Path("/repo/backend/scripts/emulator_farm.py"),
    )


def test_parse_notification_evidence_keeps_only_instagram_recipient_ids() -> None:
    raw = """
NotificationRecord(0x1: pkg=com.other.app user=UserHandle{0})
  postTime=1787200000000
  extras={com.instagram.android.igns.logging.intended_recipient_id=11111111111}
NotificationRecord(0x2: pkg=com.instagram.android user=UserHandle{0})
  postTime=1787200123000
  extras={com.instagram.android.igns.logging.intended_recipient_id=String ("22222222222"),
          com.instagram.android.igns.logging.push_id=push-222,
          com.instagram.android.igns.logging.push_category=subscription_daily_digest,
          com.instagram.android.igns.logging.ig_action=clips_home?media_list=123,456,
          cache_ent_id=cache-1,
          total_non_mmc_media_count=4,
          android.subText=ubc.wat2do.io,
          android.title=Sensitive title,
          android.text=Sensitive body}
"""

    assert script.parse_notification_evidence(raw) == (
        script.NotificationEvidence(
            recipient_id="22222222222",
            post_time_epoch_seconds=1787200123,
            push_id="push-222",
            push_category="subscription_daily_digest",
            instagram_action="clips_home?media_list=123,456",
            cache_ent_id="cache-1",
            total_media_count="4",
            notification_title="Sensitive title",
            notification_text="Sensitive body",
            account_username="ubc.wat2do.io",
        ),
    )


def test_parse_notification_evidence_preserves_explicit_digest_media_ids() -> None:
    raw = """
NotificationRecord(0x2: pkg=com.instagram.android user=UserHandle{0})
  postTime=1787200123000
  extras={com.instagram.android.igns.logging.intended_recipient_id=46189693055,
          com.instagram.android.igns.logging.push_id=push-70,
          com.instagram.android.igns.logging.push_category=subscription_daily_digest,
          com.instagram.android.igns.logging.ig_action=clips_home?media_list=3970822765943978975%2C3970938492779828361%2C3970464121980272014&notif_type=subscription_daily_digest&cache_ent_id=18068350061541056&total_non_mmc_media_count=70,
          cache_ent_id=18068350061541056&total_non_mmc_media_count=70,
          android.subText=usask.wat2do.io,
          total_non_mmc_media_count=70}
"""

    evidence = script.parse_notification_evidence(raw)

    assert evidence == (
        script.NotificationEvidence(
            recipient_id="46189693055",
            post_time_epoch_seconds=1787200123,
            push_id="push-70",
            push_category="subscription_daily_digest",
            instagram_action=(
                "clips_home?media_list=3970822765943978975%2C3970938492779828361%2C"
                "3970464121980272014&notif_type=subscription_daily_digest&"
                "cache_ent_id=18068350061541056&total_non_mmc_media_count=70"
            ),
            cache_ent_id="18068350061541056",
            total_media_count="70",
            account_username="usask.wat2do.io",
        ),
    )
    assert script._notification_dictionary(evidence[0]) == {
        "com.instagram.android.igns.logging.intended_recipient_id": "46189693055",
        "com.instagram.android.igns.logging.push_id": "push-70",
        "com.instagram.android.igns.logging.push_category": "subscription_daily_digest",
        "com.instagram.android.igns.logging.ig_action": (
            "clips_home?media_list=3970822765943978975%2C3970938492779828361%2C"
            "3970464121980272014&notif_type=subscription_daily_digest&"
            "cache_ent_id=18068350061541056&total_non_mmc_media_count=70"
        ),
        "cache_ent_id": "18068350061541056",
        "total_non_mmc_media_count": "70",
        "android.subText": "usask.wat2do.io",
    }


def test_launch_agent_runs_the_farm_cycle_every_thirty_minutes(tmp_path: Path) -> None:
    payload = script.launch_agent_payload(_paths(tmp_path))

    assert payload["Label"] == "io.wat2do.emulator-farm.check"
    assert payload["ProgramArguments"] == [
        "/usr/bin/python3",
        "/repo/backend/scripts/emulator_farm.py",
        "run-cycle",
        "--json",
    ]
    assert payload["RunAtLoad"] is True
    assert payload["StartInterval"] == 1800
    assert payload["EnvironmentVariables"]["PATH"] == script.LAUNCH_AGENT_PATH
    assert plistlib.loads(plistlib.dumps(payload))["StartInterval"] == 1800


def test_run_cycle_uses_the_controlled_launch_mode(monkeypatch, tmp_path: Path) -> None:
    launch_modes: list[bool] = []

    def record_start(*_args, headless: bool) -> None:
        launch_modes.append(headless)
        raise RuntimeError("stop after recording launch mode")

    monkeypatch.setattr(script, "start_nodes", record_start)

    with pytest.raises(RuntimeError, match="stop after recording launch mode"):
        script.run_cycle(_paths(tmp_path))

    assert launch_modes == [False]


def test_visible_notifications_include_cache_ent_id() -> None:
    notification = script.NotificationEvidence(
        recipient_id="46189693055",
        post_time_epoch_seconds=1787200123,
        push_id="push-1",
        push_category="subscription_daily_digest",
        instagram_action="clips_home?media_list=123,456",
        cache_ent_id="cache-1",
        total_media_count="4",
        notification_title="A post title",
        notification_text="A post body",
        account_username="usask.wat2do.io",
    )

    assert script.visible_notifications(
        {"ig_node_1": (notification,)},
        observed_at="2026-08-25T01:24:35+00:00",
    ) == [
        {
            "node": "ig_node_1",
            "observed_at": "2026-08-25T01:24:35+00:00",
            "recipient_id": "46189693055",
            "post_time_epoch_seconds": 1787200123,
            "push_id": "push-1",
            "push_category": "subscription_daily_digest",
            "instagram_action": "clips_home?media_list=123,456",
            "cache_ent_id": "cache-1",
            "total_media_count": "4",
            "notification_title": "A post title",
            "notification_text": "A post body",
            "account_username": "usask.wat2do.io",
        }
    ]


def test_run_cycle_parser_exposes_manual_notification_output() -> None:
    arguments = script._parser().parse_args(["run-cycle", "--json", "--show-notifications"])

    assert arguments.show_notifications is True


def test_monitor_parser_exposes_live_notification_monitoring() -> None:
    arguments = script._parser().parse_args(["monitor"])

    assert arguments.command == "monitor"


def test_resolve_digest_parser_requires_the_receiving_account_username() -> None:
    with pytest.raises(SystemExit) as raised:
        script._parser().parse_args(
            [
                "resolve-digest",
                "--recipient-id",
                "46189693055",
                "--cache-ent-id",
                "cache-1",
                "--instagram-action",
                "clips_home?media_id=123",
            ]
        )

    assert raised.value.code == 2


def test_resolve_digest_command_waits_for_shared_queue_and_merges_result(
    monkeypatch,
    capsys,
) -> None:
    calls = []

    class QueuedResolver:
        def resolve(self, recipient_id, account_username, cache_ent_id):
            calls.append((recipient_id, account_username, cache_ent_id))
            return script.DigestResolution(
                account_username=account_username,
                media_ids=("123", "456"),
                page_count=2,
            )

    monkeypatch.setattr(script, "QueuedInstagramDigestResolver", QueuedResolver)
    monkeypatch.setattr(
        script.sys,
        "argv",
        [
            "emulator_farm.py",
            "resolve-digest",
            "--recipient-id",
            "46189693055",
            "--account-username",
            "usask.wat2do.io",
            "--cache-ent-id",
            "cache-1",
            "--instagram-action",
            "clips_home?media_id=123&cache_ent_id=cache-1",
            "--total-media-count",
            "2",
        ],
    )

    assert script.main() == 0

    assert calls == [("46189693055", "usask.wat2do.io", "cache-1")]
    assert json.loads(capsys.readouterr().out) == {
        "account_username": "usask.wat2do.io",
        "cache_ent_id": "cache-1",
        "page_count": 2,
        "media_ids": ["123", "456"],
        "instagram_action": "clips_home?media_list=123%2C456&cache_ent_id=cache-1",
    }


def test_resolve_digest_command_reports_queue_failure(monkeypatch, capsys) -> None:
    class UnavailableQueue:
        def resolve(self, *_args):
            raise script.BrowserDigestError("Instagram browser worker is unavailable")

    monkeypatch.setattr(script, "QueuedInstagramDigestResolver", UnavailableQueue)
    monkeypatch.setattr(
        script.sys,
        "argv",
        [
            "emulator_farm.py",
            "resolve-digest",
            "--recipient-id",
            "46189693055",
            "--account-username",
            "usask.wat2do.io",
            "--cache-ent-id",
            "cache-1",
            "--instagram-action",
            "clips_home?cache_ent_id=cache-1",
        ],
    )

    assert script.main() == 1

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "error: Instagram browser worker is unavailable\n"


def test_monitor_prints_each_notification_once_and_dispatches_immediately(
    monkeypatch,
    tmp_path: Path,
    capsys,
) -> None:
    paths = _paths(tmp_path)
    node = script.CONTROL.nodes[0]
    notification = script.NotificationEvidence(
        recipient_id="42518030160",
        post_time_epoch_seconds=1787200123,
        push_id="live-push",
        push_category="post",
        instagram_action="clips_home?media_id=123",
        account_username="ubc.wat2do.io",
    )
    monkeypatch.setattr(script, "start_nodes", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(script, "configure_nodes", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        script,
        "_current_evidence_by_node",
        lambda *_args: {node.name: (notification,)},
    )
    dispatches = iter(
        (
            {
                "dispatched_count": 1,
                "dispatched_recipient_ids": [notification.recipient_id],
                "already_dispatched_count": 0,
                "duplicate_observation_count": 0,
                "incomplete_recipient_ids": [],
                "stale_recipient_ids": [],
            },
            {
                "dispatched_count": 0,
                "dispatched_recipient_ids": [],
                "already_dispatched_count": 1,
                "duplicate_observation_count": 0,
                "incomplete_recipient_ids": [],
                "stale_recipient_ids": [],
            },
        )
    )
    monkeypatch.setattr(script, "dispatch_notifications", lambda *_args: next(dispatches))
    sleep_count = 0

    def stop_after_second_poll(_seconds: float) -> None:
        nonlocal sleep_count
        sleep_count += 1
        if sleep_count == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(script.time, "sleep", stop_after_second_poll)

    script.monitor(paths)

    payload = json.loads(capsys.readouterr().out)
    assert payload["observed_notifications"] == [
        {
            "node": node.name,
            "observed_at": payload["checked_at"],
            "recipient_id": notification.recipient_id,
            "post_time_epoch_seconds": 1787200123,
            "push_id": "live-push",
            "push_category": "post",
            "instagram_action": "clips_home?media_id=123",
            "cache_ent_id": None,
            "total_media_count": None,
            "notification_title": None,
            "notification_text": None,
            "account_username": "ubc.wat2do.io",
        }
    ]
    assert payload["dispatch"]["dispatched_count"] == 1


def test_node_selection_rejects_unknown_nodes() -> None:
    with pytest.raises(script.FarmError, match="Unknown emulator node"):
        script._selected_nodes(["ig_node_4"])


def test_platform_package_comes_from_the_system_image_control() -> None:
    assert script._platform_package() == "platforms;android-35"


def test_checked_notification_evidence_does_not_store_notification_content(
    monkeypatch,
    tmp_path: Path,
) -> None:
    paths = _paths(tmp_path)
    nodes = script.CONTROL.nodes
    paths.evidence.parent.mkdir(parents=True)
    paths.evidence.write_text(
        '{"ig_node_1":{"46189693055":"2026-08-22T00:00:00+00:00"},'
        '"ig_node_2":{"45870501433":"2026-08-22T00:00:00+00:00"}}'
    )
    monkeypatch.setattr(
        script,
        "_adb_devices",
        lambda _paths: {script._serial(node): "device" for node in nodes},
    )
    observed = {
        nodes[0].name: (
            script.NotificationEvidence(
                "42518030160",
                None,
                account_username="ubc.wat2do.io",
                notification_text="Sensitive body",
            ),
        )
    }
    monkeypatch.setattr(
        script,
        "_current_evidence",
        lambda _paths, node: observed[node.name],
    )

    payload = script.check_notifications(paths, nodes)

    assert payload["within_recipient_capacity"] is True
    persisted = paths.evidence.read_text(encoding="utf-8")
    assert "42518030160" in persisted
    assert "ig_node_2" not in persisted
    assert "46189693055" not in persisted
    assert "45870501433" not in persisted
    assert "title" not in persisted
    assert "body" not in persisted
    assert "ubc.wat2do.io" not in persisted


def test_notification_check_records_any_recipient_on_its_observed_node(
    monkeypatch,
    tmp_path: Path,
) -> None:
    paths = _paths(tmp_path)
    nodes = (
        script.CONTROL.nodes[0],
        EmulatorFarmNodeControl(
            name="ig_node_2",
            port=5556,
        ),
    )
    monkeypatch.setattr(
        script,
        "_adb_devices",
        lambda _paths: {script._serial(node): "device" for node in nodes},
    )
    observed = {
        nodes[0].name: (script.NotificationEvidence("76214170483", None),),
        nodes[1].name: (script.NotificationEvidence("99999999999", None),),
    }
    monkeypatch.setattr(
        script,
        "_current_evidence",
        lambda _paths, node: observed[node.name],
    )

    payload = script.check_notifications(paths, nodes)

    assert payload["within_recipient_capacity"] is True
    assert payload["nodes"][0]["recipient_ids"] == ["76214170483"]
    assert payload["nodes"][1]["recipient_ids"] == ["99999999999"]


def test_dispatches_each_complete_push_once_without_persisting_notification_content(
    monkeypatch,
    tmp_path: Path,
) -> None:
    paths = _paths(tmp_path)
    nodes = script.CONTROL.nodes
    recipient_id = "99999999999"
    observed = script.NotificationEvidence(
        recipient_id=recipient_id,
        post_time_epoch_seconds=int(script.utc_now().timestamp()),
        push_id="private-push-id",
        push_category="subscription_daily_digest",
        instagram_action="clips_home?media_list=123,456",
        cache_ent_id="private-cache-id",
        total_media_count="4",
        account_username="ubc.wat2do.io",
    )
    evidence_by_node = {
        nodes[0].name: (observed, observed),
    }
    requests: list[tuple[list[str], str]] = []
    monkeypatch.setattr(script, "_resolve_tool", lambda _paths, _name: Path("/opt/bin/gh"))

    def record_command(arguments, *, input_text=None, **_kwargs):
        requests.append(([str(argument) for argument in arguments], input_text or ""))

    monkeypatch.setattr(script, "_command", record_command)

    first = script.dispatch_notifications(paths, nodes, evidence_by_node)
    second = script.dispatch_notifications(paths, nodes, evidence_by_node)

    assert first["dispatched_count"] == 1
    assert first["duplicate_observation_count"] == 1
    assert second["dispatched_count"] == 0
    assert second["already_dispatched_count"] == 1
    assert len(requests) == 1
    assert requests[0][0] == [
        "/opt/bin/gh",
        "api",
        "--method",
        "POST",
        "repos/wat2dov2/wat2do-ui/dispatches",
        "--input",
        "-",
    ]
    request_payload = json.loads(requests[0][1])
    assert request_payload["event_type"] == "new_instagram_post"
    assert request_payload["client_payload"]["intended_recipient_id"] == recipient_id
    assert request_payload["client_payload"]["notification_dict"] == {
        "com.instagram.android.igns.logging.intended_recipient_id": recipient_id,
        "com.instagram.android.igns.logging.push_id": "private-push-id",
        "com.instagram.android.igns.logging.push_category": "subscription_daily_digest",
        "com.instagram.android.igns.logging.ig_action": "clips_home?media_list=123,456",
        "cache_ent_id": "private-cache-id",
        "total_non_mmc_media_count": "4",
        "android.subText": "ubc.wat2do.io",
    }
    persisted = paths.dispatches.read_text(encoding="utf-8")
    assert "private-push-id" not in persisted
    assert "private-cache-id" not in persisted
    assert recipient_id not in persisted
    assert "ubc.wat2do.io" not in persisted


def test_dispatch_forwards_digest_without_opening_the_browser(
    monkeypatch,
    tmp_path: Path,
) -> None:
    paths = _paths(tmp_path)
    node = script.CONTROL.nodes[0]
    digest = script.NotificationEvidence(
        recipient_id="99999999999",
        post_time_epoch_seconds=int(script.utc_now().timestamp()),
        push_id="digest-push",
        push_category="subscription_daily_digest",
        instagram_action="clips_home?media_list=123,456",
        cache_ent_id="cache-1",
        total_media_count="4",
        account_username="ubc.wat2do.io",
    )
    requests: list[str] = []
    monkeypatch.setattr(script, "_resolve_tool", lambda *_args: Path("/opt/bin/gh"))
    monkeypatch.setattr(
        script,
        "QueuedInstagramDigestResolver",
        lambda: pytest.fail("dispatcher must not open the browser"),
    )
    monkeypatch.setattr(
        script,
        "_dispatch_notification",
        lambda _github, notification: requests.append(notification[script._PUSH_ID_KEY]),
    )

    payload = script.dispatch_notifications(
        paths,
        (node,),
        {node.name: (digest,)},
    )

    assert requests == ["digest-push"]
    assert payload["dispatched_count"] == 1
    assert "digest-push" not in paths.dispatches.read_text(encoding="utf-8")


def test_dispatch_skips_incomplete_notifications(
    monkeypatch,
    tmp_path: Path,
) -> None:
    paths = _paths(tmp_path)
    node = script.CONTROL.nodes[0]
    evidence_by_node = {node.name: (script.NotificationEvidence("42518030160", None),)}
    monkeypatch.setattr(
        script,
        "_resolve_tool",
        lambda *_args: pytest.fail("GitHub CLI should not be resolved without a dispatch"),
    )

    payload = script.dispatch_notifications(paths, (node,), evidence_by_node)

    assert payload["dispatched_count"] == 0
    assert payload["incomplete_recipient_ids"] == ["42518030160"]


def test_dispatch_waits_for_receiving_username_before_recording_delivery(
    monkeypatch,
    tmp_path: Path,
) -> None:
    paths = _paths(tmp_path)
    node = script.CONTROL.nodes[0]
    evidence = script.NotificationEvidence(
        recipient_id="42518030160",
        post_time_epoch_seconds=int(script.utc_now().timestamp()),
        push_id="push-missing-username",
        push_category="subscription_daily_digest",
        instagram_action="clips_home?cache_ent_id=cache-1",
    )
    monkeypatch.setattr(
        script,
        "_resolve_tool",
        lambda *_args: pytest.fail("An unroutable notification must not be dispatched"),
    )

    payload = script.dispatch_notifications(paths, (node,), {node.name: (evidence,)})

    assert payload["dispatched_count"] == 0
    assert payload["incomplete_recipient_ids"] == ["42518030160"]
    assert not paths.dispatches.exists()
