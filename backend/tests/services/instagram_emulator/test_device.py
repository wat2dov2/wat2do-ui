import fcntl
import random
import re
import subprocess

import pytest

from services.instagram_emulator import device as module

SCREEN = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="" content-desc="Send post. Button. Double tap to choose who to send this post to." bounds="[398,1544][461,1665]" />
<node text="Your story" content-desc="" bounds="[121,2098][379,2161]" />
<node text="" content-desc="Flat" bounds="[5,5][5,9]" />
</hierarchy>UI hierchary dumped to: /dev/tty"""


def _device(outputs, commands):
    def run(command, **_kwargs):
        commands.append(command)
        returncode, stdout = outputs.pop(0)
        return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")

    return module.EmulatorDevice(run=run, sleep=lambda _seconds: None, rng=random.Random(4))


def test_screen_reads_labelled_controls_and_skips_empty_bounds() -> None:
    nodes = _device([(0, SCREEN)], []).screen()
    assert [node.text or node.description for node in nodes] == [
        "Send post. Button. Double tap to choose who to send this post to.",
        "Your story",
    ]


def test_screen_retries_while_the_app_is_animating() -> None:
    commands = []
    nodes = _device([(1, ""), (1, ""), (0, SCREEN)], commands).screen()
    assert len(nodes) == 2 and len(commands) == 3


def test_screen_retries_when_the_dump_prints_an_error_instead() -> None:
    commands = []
    error = "ERROR: null root node returned by UiTestAutomationBridge."
    nodes = _device([(0, error), (0, SCREEN)], commands).screen()
    assert len(nodes) == 2 and len(commands) == 2


def test_a_screen_that_never_settles_raises() -> None:
    attempts = [(1, "")] * module._SCREEN_READ_ATTEMPTS
    with pytest.raises(module.EmulatorError):
        _device(attempts, []).screen()


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


def test_switching_android_users_is_confirmed() -> None:
    outputs = [(0, "0\n"), (0, ""), (0, ""), (0, ""), (0, "0\n")]
    with pytest.raises(module.EmulatorError, match="switch Android users"):
        _device(outputs, []).use_android_user(10)


def test_the_current_android_user_is_not_switched_again() -> None:
    commands = []
    _device([(0, "10\n")], commands).use_android_user(10)
    assert len(commands) == 1


def test_unlabelled_controls_are_found_by_their_resource_id() -> None:
    screen = SCREEN.replace(
        "</hierarchy>",
        '<node text="" content-desc="" resource-id="com.instagram.android:id/action_bar_button_action" bounds="[912,128][1059,275]" />\n</hierarchy>',
    )
    nodes = _device([(0, screen)], []).screen()
    check = module.Node("", "", (912, 128, 1059, 275), "action_bar_button_action")
    assert check in nodes
    assert check.labelled(re.compile(r"^action_bar_button_action$"))


def test_typing_sends_one_escaped_character_at_a_time() -> None:
    commands = []
    _device([(0, "")] * 6, commands).type_text("a b'&")
    assert [command[-1] for command in commands] == ["a", "%s", "b", "\\'", "\\&"]


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
</hierarchy>UI hierchary dumped to: /dev/tty"""


def test_waiting_declines_an_announcement_covering_the_app() -> None:
    commands = []
    tap = (0, "")
    node = _device([(0, PROMPT), tap, (0, SCREEN)], commands).wait_for(re.compile("^Your story$"))
    assert node.text == "Your story"
    assert commands[1][-3:-2] == ["tap"]


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
</hierarchy>UI hierchary dumped to: /dev/tty"""


def test_waiting_closes_the_low_storage_warning() -> None:
    commands = []
    tap = (0, "")
    node = _device([(0, LOW_STORAGE), tap, (0, SCREEN)], commands).wait_for(
        re.compile("^Your story$")
    )
    assert node.text == "Your story"
    assert commands[1][-3:-2] == ["tap"]


def test_free_space_is_read_from_the_data_partition() -> None:
    df = "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-44 10167132 9541120 626012 94% /data\n"
    commands = []
    assert _device([(0, df)], commands).free_data_megabytes() == 611
    assert commands[0][-3:] == ["df", "-k", "/data"]
