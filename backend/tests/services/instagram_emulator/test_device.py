import fcntl
import io
import random
import re
import subprocess

import pytest
from PIL import Image, ImageDraw

from services.instagram_emulator import device as module

SCREEN = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="" content-desc="Send post. Button. Double tap to choose who to send this post to." bounds="[398,1544][461,1665]" />
<node text="Your story" content-desc="" bounds="[121,2098][379,2161]" />
<node text="" content-desc="Flat" bounds="[5,5][5,9]" />
</hierarchy>"""


def _device(outputs, commands, screens=()):
    """A device whose adb calls answer ``outputs`` and whose screen reads answer
    ``screens`` in turn: a hierarchy, or an error the read raises."""

    def run(command, **_kwargs):
        commands.append(command)
        returncode, stdout = outputs.pop(0)
        return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")

    reads = list(screens)

    def read_hierarchy():
        answer = reads.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    return module.EmulatorDevice(
        run=run, sleep=lambda _seconds: None, rng=random.Random(4), read_hierarchy=read_hierarchy
    )


def test_screen_reads_labelled_controls_and_skips_empty_bounds() -> None:
    nodes = _device([], [], [SCREEN]).screen()
    assert [node.text or node.description for node in nodes] == [
        "Send post. Button. Double tap to choose who to send this post to.",
        "Your story",
    ]


def test_screen_leaves_out_views_hidden_from_the_user() -> None:
    # The song search keeps its For you tab under the results, marked not visible.
    hidden = SCREEN.replace(
        "</hierarchy>",
        '<node text="For you" content-desc="" visible-to-user="false" bounds="[0,300][300,400]" />'
        '<node text="Lyrics" content-desc="" visible-to-user="true" bounds="[300,300][600,400]" />'
        "</hierarchy>",
    )
    labels = [node.text or node.description for node in _device([], [], [hidden]).screen()]
    assert "For you" not in labels and "Lyrics" in labels


def test_screen_retries_while_the_app_is_animating() -> None:
    unreadable = module.EmulatorError("Emulator screen could not be read")
    nodes = _device([], [], [unreadable, unreadable, SCREEN]).screen()
    assert len(nodes) == 2


def test_screen_retries_when_the_read_returns_an_error_instead() -> None:
    error = "ERROR: null root node returned by UiTestAutomationBridge."
    nodes = _device([], [], [error, SCREEN]).screen()
    assert len(nodes) == 2


def test_a_screen_that_never_settles_raises() -> None:
    attempts = [module.EmulatorError("unreadable")] * module._SCREEN_READ_ATTEMPTS
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


def test_a_user_switch_waits_only_until_the_user_is_in_front_and_unlocked() -> None:
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
    ]
    _device(outputs, commands).use_android_user(10)
    assert outputs == []
    assert commands[1][-3:] == ["am", "switch-user", "10"]


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


def test_reclaiming_waits_a_day_after_the_last_one(reclaimed_path) -> None:
    reclaimed_path.touch()
    commands = []
    assert _device([(0, _df(200_000))], commands).reclaim_data() == 195
    assert len(commands) == 1


def test_reclaiming_deletes_instagram_caches_and_clears_the_listed_apps(reclaimed_path) -> None:
    users = sorted(set(module.CONTROL.android_user_by_school.values()))
    clears = len(module.CONTROL.reclaim_android_users) * len(module.CONTROL.reclaim_packages)
    commands = []
    restart = [(0, ""), (1, ""), (0, "1\n"), (0, ""), (0, "")]
    outputs = [(0, "")] * len(users) + [(0, "Success\n")] * clears + restart + [(0, _df(800_000))]
    assert _device(outputs, commands).reclaim_data() == 781
    deletes = commands[: len(users)]
    for user, command in zip(users, deletes, strict=True):
        assert command[3:8] == ["shell", "su", "0", "sh", "-c"]
        script = command[-1]
        assert f"am force-stop --user {user} com.instagram.android" in script
        assert f"/data/user/{user}/com.instagram.android/files/one_cache_path" in script
        assert "databases" not in script and "shared_prefs" not in script
    cleared = [command[-4:] for command in commands[len(users) : len(users) + clears]]
    assert cleared == [
        ["clear", "--user", str(user), package]
        for user in module.CONTROL.reclaim_android_users
        for package in module.CONTROL.reclaim_packages
    ]
    assert reclaimed_path.exists()
    # The emulator restarts last, after the record that stops tomorrow's repeat.
    assert commands[len(users) + clears][3:] == ["emu", "kill"]


def _inbox(account):
    return [module.Node(account, "", (293, 167, 787, 236), "igds_action_bar_title")]


def test_the_account_already_open_is_confirmed_from_the_inbox_title(monkeypatch) -> None:
    device = _device([], [])
    opened, taps = [], []
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: opened.append(url))
    monkeypatch.setattr(device, "screen", lambda: _inbox("wat2do.ubc"))
    monkeypatch.setattr(device, "tap", lambda node, hold_ms=0: taps.append(node))
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
    monkeypatch.setattr(device, "tap", lambda node, hold_ms=0: taps.append((node, hold_ms)))
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
    monkeypatch.setattr(device, "tap", lambda node, hold_ms=0: taps.append(node))
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


def test_a_switch_that_does_not_land_on_the_account_fails(monkeypatch) -> None:
    device = _device([], [])
    profile = module.Node("", "Profile", (933, 2172, 1012, 2251), "profile_tab")
    name = module.Node("wat2do.ubc", "", (221, 1300, 534, 1355))
    row = module.Node("", "wat2do.ubc, 2 follows", (42, 1130, 1038, 1303))
    screens = iter(([_inbox("wat2do.sfu") + [profile]] * 2 + [[row, name]] * 2) * 2)
    monkeypatch.setattr(device, "open_instagram", lambda user, url=None: None)
    monkeypatch.setattr(device, "screen", lambda: next(screens, _inbox("wat2do.sfu")))
    monkeypatch.setattr(device, "tap", lambda node, hold_ms=0: None)
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


class _Server:
    """A uiautomator2 server that fails its first read, as one does when the emulator restarts."""

    def __init__(self, reads):
        self.reads = reads

    def dump_hierarchy(self):
        answer = self.reads.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_the_resident_reader_reconnects_after_a_failed_read(monkeypatch) -> None:
    servers = [_Server([ConnectionError("server gone")]), _Server([SCREEN])]
    connects = []

    def connect(serial):
        connects.append(serial)
        return servers.pop(0)

    monkeypatch.setattr(module.uiautomator2, "connect", connect)
    reader = module._ResidentReader()
    with pytest.raises(module.EmulatorError, match="could not be read"):
        reader()
    assert reader() == SCREEN
    assert connects == [module.CONTROL.serial, module.CONTROL.serial]
