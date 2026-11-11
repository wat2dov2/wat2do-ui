import fcntl
import io
import os
import random
import re
import subprocess
from datetime import datetime, timedelta

import pytest
from PIL import Image, ImageDraw

from services.instagram_emulator import device as module
from services.instagram_emulator.screen_reader import ScreenReaderError

SCREEN = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="" content-desc="Send post. Button. Double tap to choose who to send this post to." bounds="[398,1544][461,1665]" />
<node text="Your story" content-desc="" bounds="[121,2098][379,2161]" />
<node text="" content-desc="Flat" bounds="[5,5][5,9]" />
</hierarchy>"""


class _Reader:
    """Hands out queued screens; a queued error is raised, as a failing reader would."""

    def __init__(self, screens):
        self.screens = list(screens)
        self.stops = 0

    def read(self):
        screen = self.screens.pop(0)
        if isinstance(screen, Exception):
            raise screen
        return screen

    def stop(self):
        self.stops += 1


def _device(outputs, commands, screens=()):
    def run(command, **_kwargs):
        commands.append(command)
        returncode, stdout = outputs.pop(0)
        return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")

    return module.EmulatorDevice(
        run=run, sleep=lambda _seconds: None, rng=random.Random(4), reader=_Reader(screens)
    )


def test_screen_reads_labelled_controls_and_skips_empty_bounds() -> None:
    nodes = _device([], [], [SCREEN]).screen()
    assert [node.text or node.description for node in nodes] == [
        "Send post. Button. Double tap to choose who to send this post to.",
        "Your story",
    ]


def test_screen_retries_while_the_reader_starts_again() -> None:
    device = _device([], [], [ScreenReaderError(), ScreenReaderError(), SCREEN])
    assert len(device.screen()) == 2
    assert device._reader.screens == []


def test_screen_retries_while_no_window_is_active() -> None:
    device = _device([], [], ["", SCREEN])
    assert len(device.screen()) == 2
    assert device._reader.screens == []


def test_a_screen_that_cannot_be_read_raises() -> None:
    attempts = [ScreenReaderError()] * module._SCREEN_READ_ATTEMPTS
    with pytest.raises(module.EmulatorError):
        _device([], [], attempts).screen()


def test_labels_match_a_control_name_but_not_a_longer_word() -> None:
    share = module.labels("Send post", "Share")
    assert module.Node("", "Send post. Button.", (0, 0, 1, 1)).labelled(share)
    assert module.Node("Share", "", (0, 0, 1, 1)).labelled(share)
    assert not module.Node("", "uwbiochem shared a note", (0, 0, 1, 1)).labelled(share)
    assert not module.Node("Shared", "", (0, 0, 1, 1)).labelled(share)


def test_taps_land_inside_the_middle_of_the_control() -> None:
    commands = []
    device = _device([(0, "")] * 20, commands)
    node = module.Node("Your story", "", (100, 200, 300, 400))
    for _ in range(20):
        device.tap(node)
    for command in commands:
        x, y = int(command[-2]), int(command[-1])
        assert 150 <= x <= 250 and 250 <= y <= 350


SWITCHING = "  mCurrentFocus=Window{7f8d89e u0 android}\n"
BLANK = "  mCurrentFocus=null\n"
LAUNCHER = "  mCurrentFocus=Window{3401685 u10 com.google.android.apps.nexuslauncher/x}\n"


def test_a_user_switch_waits_until_the_users_own_screen_is_up() -> None:
    commands = []
    outputs = [
        (0, "0\n"),  # current user before the switch
        (0, ""),  # switch-user
        (0, "0\n"),  # still switching
        (0, "10\n"),
        (0, "RUNNING_LOCKED\n"),
        (0, "10\n"),
        (0, "RUNNING_UNLOCKED\n"),
        (0, ""),  # wake
        (0, ""),
        (0, SWITCHING),  # Android's switching screen
        (0, BLANK),
        (0, LAUNCHER),  # the user's home screen, still being drawn
        (0, LAUNCHER),
    ]
    device = _device(outputs, commands, ["", SCREEN])
    device.use_android_user(10)
    assert outputs == []
    assert commands[1][-3:] == ["am", "switch-user", "10"]
    assert device._reader.screens == []


def test_a_stopped_user_is_started_in_the_background() -> None:
    commands = []
    outputs = [
        (0, "RUNNING_UNLOCKED\n"),
        (0, "BOOTING\n"),
        (0, "User is not started: 12\n"),
        (0, "Success: user started\n"),
    ]
    device = _device(outputs, commands)
    assert device.user_started(10)
    assert device.user_started(11)
    assert not device.user_started(12)
    device.start_user(12)
    assert commands[2][-3:] == ["am", "get-started-user-state", "12"]
    # Started without switching to it: the user in front stays there.
    assert commands[3][-4:] == ["am", "start-user", "-w", "12"]
    assert not any("switch-user" in command for command in commands)


def test_a_user_whose_screen_is_slow_to_come_up_is_used_anyway(monkeypatch) -> None:
    ready = [(0, "0\n"), (0, ""), (0, "10\n"), (0, "RUNNING_UNLOCKED\n"), (0, ""), (0, "")]
    device = _device(ready + [(0, BLANK)] * 20, [])
    clock = iter(range(0, 1_000, 5))
    monkeypatch.setattr(device, "_monotonic", lambda: next(clock))
    device.use_android_user(10)


def test_a_user_that_never_comes_to_the_front_fails(monkeypatch) -> None:
    device = _device([(0, "0\n"), (0, "")] + [(0, "0\n")] * 20, [])
    clock = iter(range(0, 1_000, 10))
    monkeypatch.setattr(device, "_monotonic", lambda: next(clock))
    with pytest.raises(module.EmulatorError, match="switch Android users"):
        device.use_android_user(10)


def test_the_current_android_user_is_not_switched_again() -> None:
    commands = []
    _device([(0, "10\n")], commands).use_android_user(10)
    assert len(commands) == 1


def test_unlabelled_controls_are_found_by_their_resource_id() -> None:
    screen = SCREEN.replace(
        "</hierarchy>",
        '<node text="" content-desc="" resource-id="com.instagram.android:id/action_bar_button_action" bounds="[912,128][1059,275]" />\n</hierarchy>',
    )
    nodes = _device([], [], [screen]).screen()
    check = module.Node("", "", (912, 128, 1059, 275), "action_bar_button_action")
    assert check in nodes
    assert check.labelled(re.compile(r"^action_bar_button_action$"))


def test_typing_sends_one_escaped_character_at_a_time() -> None:
    commands = []
    _device([(0, "")] * 6, commands).type_text("a b'&")
    assert [command[-1] for command in commands] == ["a", "%s", "b", "\\'", "\\&"]


def test_scrolling_drags_the_way_the_content_should_move() -> None:
    commands = []
    device = _device([(0, ""), (0, "")], commands)
    device.scroll_down()
    device.scroll_up()
    down, up = ([int(value) for value in command[-5:-1]] for command in commands)
    # Older content is above: scrolling down drags up, scrolling up drags a little down.
    assert down[3] < down[1] and up[3] > up[1]
    assert up[3] - up[1] < down[1] - down[3]


def test_the_end_of_a_hold_stops_the_screen_reader(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(module, "_LOCK_PATH", tmp_path / "emulator.lock")
    device = _device([], [], [SCREEN])
    with module.exclusive():
        with module.exclusive():
            device.screen()
        # A nested hold ending leaves the reader running for the rest of the job.
        assert device._reader.stops == 0
    assert device._reader.stops == 1


def test_holding_the_emulator_is_reentrant_but_exclusive(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(module, "_LOCK_PATH", tmp_path / "emulator.lock")
    with module.exclusive():
        with module.exclusive():
            pass
        other = (tmp_path / "emulator.lock").open("a")
        with pytest.raises(BlockingIOError):
            fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        other.close()
    with (tmp_path / "emulator.lock").open("a") as other:
        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)


PROMPT = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="Introducing instants" content-desc="" bounds="[126,1720][780,1790]" />
<node text="Not now" content-desc="" bounds="[466,2080][612,2140]" />
</hierarchy>"""


def test_waiting_declines_an_announcement_covering_the_app() -> None:
    commands = []
    tap = (0, "")
    node = _device([tap], commands, [PROMPT, SCREEN]).wait_for(re.compile("^Your story$"))
    assert node.text == "Your story"
    assert commands[0][-3:-2] == ["tap"]


def test_an_account_below_the_switcher_fold_is_scrolled_into_view(monkeypatch) -> None:
    device = _device([], [])
    row = module.Node("", "wat2do.ubc, 2 follows", (42, 1130, 1038, 1303))
    name = module.Node("wat2do.dalhousie", "", (221, 1900, 534, 1955))
    screens = [[row], [row], [row, name]]
    scrolls = []
    monkeypatch.setattr(device, "screen", lambda: screens[min(len(scrolls), 2)])
    monkeypatch.setattr(device, "scroll_down", lambda: scrolls.append(1))
    assert device._account_in_switcher("wat2do.dalhousie") == name
    assert len(scrolls) == 2


LOW_STORAGE = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="Low device storage" content-desc="" bounds="[370,1000][710,1060]" />
<node text="Close" content-desc="" bounds="[490,1440][590,1500]" />
</hierarchy>"""


def test_waiting_closes_the_low_storage_warning() -> None:
    commands = []
    tap = (0, "")
    node = _device([tap], commands, [LOW_STORAGE, SCREEN]).wait_for(re.compile("^Your story$"))
    assert node.text == "Your story"
    assert commands[0][-3:-2] == ["tap"]


NOT_RESPONDING = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="Instagram isn't responding" content-desc="" bounds="[90,1300][990,1380]" />
<node text="Close app" content-desc="" bounds="[90,1420][990,1520]" />
<node text="Wait" content-desc="" bounds="[90,1560][990,1660]" />
</hierarchy>"""


def test_waiting_closes_a_frozen_instagram() -> None:
    commands = []
    tap = (0, "")
    node = _device([tap], commands, [NOT_RESPONDING, SCREEN]).wait_for(re.compile("^Your story$"))
    assert node.text == "Your story"
    x, y = int(commands[0][-2]), int(commands[0][-1])
    assert 90 <= x <= 990 and 1420 <= y <= 1520


def test_waiting_waits_for_a_frozen_android_process() -> None:
    commands = []
    tap = (0, "")
    dialog = NOT_RESPONDING.replace("Instagram isn't", "System UI isn't")
    _device([tap], commands, [dialog, SCREEN]).wait_for(re.compile("^Your story$"))
    assert 1560 <= int(commands[0][-1]) <= 1660


def test_free_space_is_read_from_the_data_partition() -> None:
    df = "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-44 10167132 9541120 626012 94% /data\n"
    commands = []
    assert _device([(0, df)], commands).free_data_megabytes() == 611
    assert commands[0][-3:] == ["df", "-k", "/data"]


def _df(free_kilobytes):
    return f"Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-44 10167132 0 {free_kilobytes} 0% /data\n"


@pytest.fixture(autouse=True)
def reclaimed_path(monkeypatch, tmp_path):
    path = tmp_path / "reclaimed"
    monkeypatch.setattr(module, "_RECLAIMED_PATH", path)
    return path


def test_reclaiming_waits_for_the_next_reclaim_hour(reclaimed_path) -> None:
    reclaimed_path.touch()
    commands = []
    assert _device([(0, _df(200_000))], commands).reclaim_data() == 195
    assert len(commands) == 1


def test_the_reclaim_is_due_once_a_day_from_its_hour(reclaimed_path) -> None:
    hour = module.CONTROL.reclaim_hour
    today = datetime.now().astimezone().replace(hour=hour, minute=0, second=0, microsecond=0)
    assert module.reclaim_due(today)
    # Last done the morning before: due again from today's hour, not 24 hours later.
    yesterday = (today - timedelta(days=1, minutes=-5)).timestamp()
    reclaimed_path.touch()
    os.utime(reclaimed_path, (yesterday, yesterday))
    assert not module.reclaim_due(today - timedelta(minutes=1))
    assert module.reclaim_due(today)
    # Done late today, it is not done again before tomorrow's hour.
    late = (today + timedelta(hours=5)).timestamp()
    os.utime(reclaimed_path, (late, late))
    assert not module.reclaim_due(today + timedelta(hours=23))
    assert module.reclaim_due(today + timedelta(days=1))


def test_reclaiming_deletes_instagram_caches_and_leaves_it_out_of_the_stopped_state(
    reclaimed_path,
) -> None:
    users = sorted(set(module.CONTROL.android_user_by_school.values()))
    commands = []
    restart = [(0, ""), (1, ""), (0, "1\n"), (0, ""), (0, "")]
    outputs = [(0, "")] * (2 * len(users)) + restart + [(0, _df(800_000))]
    assert _device(outputs, commands).reclaim_data() == 781
    for index, user in enumerate(users):
        delete, unstop = commands[2 * index : 2 * index + 2]
        assert delete[3:8] == ["shell", "su", "0", "sh", "-c"]
        script = delete[-1]
        assert f"am force-stop --user {user} com.instagram.android" in script
        assert f"/data/user/{user}/com.instagram.android/files/one_cache_path" in script
        assert "databases" not in script and "shared_prefs" not in script
        # The force stop leaves the app stopped, getting nothing in the background, until this.
        assert unstop[3:] == ["shell", "pm", "unstop", "--user", str(user), "com.instagram.android"]
    # Nothing else is cleared: clearing Google Play services dropped the users' registration.
    assert not any("clear" in command for command in commands)
    assert reclaimed_path.exists()
    # The emulator restarts last, after the record that stops tomorrow's repeat.
    assert commands[2 * len(users)][3:] == ["emu", "kill"]


def _inbox(account):
    return [module.Node(account, "", (293, 167, 787, 236), "igds_action_bar_title")]


def test_the_account_already_open_is_confirmed_from_the_inbox_title(monkeypatch) -> None:
    device = _device([], [])
    opened, taps = [], []
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: opened.append(url))
    monkeypatch.setattr(device, "screen", lambda: _inbox("wat2do.ubc"))
    monkeypatch.setattr(device, "_press", lambda node, hold_ms: taps.append(node))
    device.use_account(11, "wat2do.ubc")
    assert opened == [module.INBOX_URL] and taps == []


def test_switching_accounts_is_confirmed_from_the_inbox_title(monkeypatch) -> None:
    device = _device([], [])
    profile = module.Node("", "Profile", (933, 2172, 1012, 2251), "profile_tab")
    row = module.Node("", "wat2do.ubc, 2 follows", (42, 1130, 1038, 1303))
    name = module.Node("wat2do.ubc", "", (221, 1300, 534, 1355))
    screens = iter([_inbox("wat2do.sfu") + [profile]] * 2 + [[row, name]] * 2)
    after = _inbox("wat2do.ubc")
    taps = []
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: None)
    monkeypatch.setattr(device, "screen", lambda: next(screens, after))
    monkeypatch.setattr(device, "_press", lambda node, hold_ms: taps.append((node, hold_ms)))
    device.use_account(11, "wat2do.ubc")
    assert taps == [(profile, 1200), (name, 0)]


def test_a_missed_switch_is_tried_again(monkeypatch) -> None:
    device = _device([], [])
    profile = module.Node("", "Profile", (933, 2172, 1012, 2251), "profile_tab")
    row = module.Node("", "wat2do.ubc, 2 follows", (42, 1130, 1038, 1303))
    name = module.Node("wat2do.ubc", "", (221, 1300, 534, 1355))
    sfu = _inbox("wat2do.sfu") + [profile]
    screens = iter([sfu, sfu, [row, name], [row, name]] * 2)
    taps = []
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: None)
    monkeypatch.setattr(device, "screen", lambda: next(screens, _inbox("wat2do.ubc")))
    monkeypatch.setattr(device, "_press", lambda node, hold_ms: taps.append(node))
    device.use_account(11, "wat2do.ubc")
    assert taps == [profile, name, profile, name]


def test_an_inbox_covered_by_a_sheet_is_reopened_after_back(monkeypatch) -> None:
    device = _device([], [])
    sheet = [module.Node("", "wat2do.ubc, 2 follows", (42, 1130, 1038, 1303))]
    backs = []
    clock = iter(range(0, 10_000, 5))
    monkeypatch.setattr(device, "_monotonic", lambda: next(clock))
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: None)
    monkeypatch.setattr(device, "back", lambda: backs.append(1))
    monkeypatch.setattr(device, "screen", lambda: _inbox("wat2do.ubc") if backs else sheet)
    assert device.open_inbox(11) == "wat2do.ubc"
    assert backs == [1]


def test_a_switch_attempt_that_fails_starts_the_app_afresh(monkeypatch) -> None:
    device = _device([], [])
    resets = []
    titles = iter([module.EmulatorError("Instagram's DM inbox could not be opened"), "wat2do.ubc"])

    def open_inbox(user):
        title = next(titles)
        if isinstance(title, Exception):
            raise title
        return title

    monkeypatch.setattr(device, "open_inbox", open_inbox)
    monkeypatch.setattr(device, "reset_app", resets.append)
    device.use_account(11, "wat2do.ubc")
    # A sheet left open by an earlier step can hide the inbox until the app starts afresh.
    assert resets == [11]


def test_starting_the_app_afresh_stops_instagram_on_that_user_only() -> None:
    commands = []
    _device([(0, ""), (0, "")], commands).reset_app(11)
    assert [command[3:] for command in commands] == [
        ["shell", "am", "force-stop", "--user", "11", "com.instagram.android"],
        # The app is closed, not left stopped as if it had never been opened.
        ["shell", "pm", "unstop", "--user", "11", "com.instagram.android"],
    ]


def test_a_switch_that_does_not_land_on_the_account_fails(monkeypatch) -> None:
    device = _device([], [])
    profile = module.Node("", "Profile", (933, 2172, 1012, 2251), "profile_tab")
    name = module.Node("wat2do.ubc", "", (221, 1300, 534, 1355))
    row = module.Node("", "wat2do.ubc, 2 follows", (42, 1130, 1038, 1303))
    screens = iter(([_inbox("wat2do.sfu") + [profile]] * 2 + [[row, name]] * 2) * 2)
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: None)
    monkeypatch.setattr(device, "screen", lambda: next(screens, _inbox("wat2do.sfu")))
    monkeypatch.setattr(device, "_press", lambda node, hold_ms: None)
    with pytest.raises(module.EmulatorError, match="did not switch"):
        device.use_account(11, "wat2do.ubc")


SAVE_LOGIN = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="Save your login info?" content-desc="" bounds="[90,1300][990,1380]" />
<node text="Save" content-desc="" bounds="[90,1420][990,1520]" />
<node text="Not now" content-desc="" bounds="[90,1560][990,1660]" />
</hierarchy>"""


def test_waiting_saves_login_info_when_offered() -> None:
    commands = []
    _device([(0, "")], commands, [SAVE_LOGIN, SCREEN]).wait_for(re.compile("^Your story$"))
    assert 1420 <= int(commands[0][-1]) <= 1520


def test_a_tap_on_a_control_waits_its_pause_before_reading_the_screen(monkeypatch) -> None:
    device = _device([(0, "")], [], [SCREEN])
    steps = []
    read = device.screen
    monkeypatch.setattr(device, "pause", lambda: steps.append("pause"))
    monkeypatch.setattr(device, "screen", lambda: steps.append("read") or read())
    device.tap_when(re.compile("^Your story$"))
    # The screen settles during the pause, so the control is tapped where it ended up.
    assert steps == ["pause", "read"]


def test_a_dialog_that_will_not_go_away_cannot_hold_a_wait_forever(monkeypatch) -> None:
    commands = []
    taps = [(0, "")] * module._PROMPTS_PER_WAIT
    device = _device(taps, commands, [PROMPT] * 50)
    clock = iter(range(0, 1_000))
    monkeypatch.setattr(device, "_monotonic", lambda: next(clock))
    with pytest.raises(module.EmulatorError, match="never showed"):
        device.wait_for(re.compile("^Your story$"), seconds=10)
    assert len(commands) == module._PROMPTS_PER_WAIT


def test_watching_returns_what_the_screen_shows_once_it_shows_it(monkeypatch) -> None:
    device = _device([], [], ["", SCREEN, SCREEN])
    story = re.compile("^Your story$")
    nodes = device.watch(lambda nodes: [node for node in nodes if node.labelled(story)])
    assert [node.text for node in nodes] == ["Your story"]


def test_watching_waits_out_a_screen_that_cannot_be_read_yet() -> None:
    # A cold start of the app leaves no window to read for longer than one read retries.
    unreadable = [ScreenReaderError()] * (module._SCREEN_READ_ATTEMPTS * 2)
    device = _device([], [], [*unreadable, SCREEN])
    assert device.wait_for(re.compile("^Your story$")).text == "Your story"


def test_a_screen_that_never_becomes_readable_still_fails_the_wait(monkeypatch) -> None:
    device = _device([], [], [ScreenReaderError()] * 200)
    clock = iter(range(0, 1_000))
    monkeypatch.setattr(device, "_monotonic", lambda: next(clock))
    with pytest.raises(module.EmulatorError, match="could not be read"):
        device.wait_for(re.compile("^Your story$"), seconds=5)


def test_watching_gives_up_with_the_last_answer(monkeypatch) -> None:
    device = _device([], [], [SCREEN] * 50)
    clock = iter(range(0, 1_000))
    monkeypatch.setattr(device, "_monotonic", lambda: next(clock))
    assert device.watch(lambda nodes: [], seconds=5) == []


def _screenshot(checked):
    image = Image.new("RGB", (300, 300), "white")
    draw = ImageDraw.Draw(image)
    # The repost arrows run around the icon's edge; a check mark fills its middle.
    draw.rectangle((100, 100, 200, 200), outline="black", width=6)
    if checked:
        draw.line((130, 150, 148, 172, 175, 125), fill="black", width=14)
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


@pytest.mark.parametrize("checked", [True, False])
def test_a_check_mark_is_read_from_the_icons_middle(checked) -> None:
    def run(command, **kwargs):
        assert command[-3:] == ["exec-out", "screencap", "-p"] and "text" not in kwargs
        return subprocess.CompletedProcess(command, 0, stdout=_screenshot(checked), stderr=b"")

    device = module.EmulatorDevice(run=run, sleep=lambda _seconds: None)
    icon = module.Node("", "Repost", (100, 100, 200, 200))
    assert device.marked(icon) is checked


def _restarting_device(outputs, commands, clock):
    def run(command, **_kwargs):
        commands.append(command[3:])
        returncode, stdout = outputs.pop(0) if outputs else (1, "")
        return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")

    def sleep(seconds):
        clock[0] += seconds

    return module.EmulatorDevice(
        run=run, sleep=sleep, monotonic=lambda: clock[0], rng=random.Random(4)
    )


def test_restart_waits_for_the_old_emulator_to_exit_before_trusting_a_boot() -> None:
    commands = []
    # kill; the old one still answers and reports booted; then it is gone; then a new
    # one is booting, then booted; then wake.
    outputs = [(0, ""), (0, "device\n"), (1, ""), (0, "0\n"), (0, "1\n"), (0, ""), (0, "")]
    _restarting_device(outputs, commands, [0.0]).restart()
    assert commands[0] == ["emu", "kill"]
    assert commands.count(["get-state"]) == 2
    assert commands.count(["shell", "getprop", "sys.boot_completed"]) == 2
    assert commands[-2:] == [
        ["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        ["shell", "wm", "dismiss-keyguard"],
    ]


def test_restart_gives_up_when_the_emulator_never_comes_back() -> None:
    with pytest.raises(module.EmulatorError, match="did not come back"):
        _restarting_device([(0, "")], [], [0.0]).restart()


def test_the_new_inbox_header_title_is_recognized():
    node = module.Node("wat2do.brocku", "", (60, 150, 500, 250), "action_bar_large_title_auto_size")
    assert node.labelled(module._INBOX_TITLE)
