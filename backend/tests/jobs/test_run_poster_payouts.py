import os
import subprocess
import sys
from pathlib import Path


def test_monthly_payout_entrypoint_imports_standalone() -> None:
    backend_directory = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [
            sys.executable,
            str(backend_directory / "jobs" / "run_poster_payouts.py"),
            "--help",
        ],
        cwd=backend_directory,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Compute promoter poster payouts" in result.stdout
