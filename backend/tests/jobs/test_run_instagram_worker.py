from jobs import run_instagram_worker as job


def test_launch_agent_keeps_the_worker_alive_without_logs():
    payload = job.launch_agent_payload()
    assert payload["ProgramArguments"][-1] == "run"
    assert payload["KeepAlive"] is True
    assert "StartInterval" not in payload
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == "/dev/null"
