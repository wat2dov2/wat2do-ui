"""One local lifecycle for Supabase infrastructure and Compose app services."""

import argparse
import json
import os
import shutil
import subprocess
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
COMPOSE = ["docker", "compose", "-p", "wat2do-dev", "-f", str(ROOT / "docker-compose.dev.yml")]


def run(command, *, cwd=ROOT, **kwargs):
    return subprocess.run(command, cwd=cwd, check=True, **kwargs)


def config():
    with (BACKEND / "supabase/config.toml").open("rb") as source:
        return tomllib.load(source)


def seed():
    database = f"supabase_db_{config()['project_id']}"
    with (BACKEND / "supabase/seed.sql").open("rb") as source:
        run(
            [
                "docker",
                "exec",
                "-i",
                database,
                "psql",
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            stdin=source,
        )


def app_environment(status):
    settings = config()
    return {
        **os.environ,
        "DEV_SUPABASE_URL": f"http://host.docker.internal:{settings['api']['port']}",
        "DEV_SUPABASE_KEY": status["ANON_KEY"],
        "DEV_SUPABASE_SECRET_KEY": status["SERVICE_ROLE_KEY"],
        "DEV_SUPABASE_JWT_ISSUER": f"{status['API_URL'].rstrip('/')}/auth/v1",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["dev", "seed", "stop", "reset"])
    action = parser.parse_args().action
    for executable in ("docker", "supabase"):
        if not shutil.which(executable):
            parser.error(f"Install {executable} first. See README.md.")
    run(["docker", "info"], stdout=subprocess.DEVNULL)

    if action == "seed":
        seed()
        return
    if action == "stop":
        run([*COMPOSE, "down"])
        run(["supabase", "stop"], cwd=BACKEND)
        return
    if action == "reset":
        if input("Delete ALL local database data and reseed? Type RESET: ") != "RESET":
            parser.error("Reset cancelled; no data changed.")
        run([*COMPOSE, "down"])
        run(["supabase", "db", "reset", "--local"], cwd=BACKEND)
        return

    compose_config = json.loads(
        run([*COMPOSE, "config", "--format", "json"], capture_output=True, text=True).stdout
    )
    backend_environment = compose_config["services"]["backend"]["environment"]
    if not (backend_environment.get("EMAIL_PROVIDER_API_KEY") or "").strip():
        parser.error("Set EMAIL_PROVIDER_API_KEY to your Resend key in backend/.env first.")

    print("Starting local Supabase infrastructure...", flush=True)
    run(["supabase", "start"], cwd=BACKEND, stdout=subprocess.DEVNULL)
    run(["supabase", "migration", "up", "--local"], cwd=BACKEND)
    seed()
    status = json.loads(
        run(
            ["supabase", "status", "-o", "json"], cwd=BACKEND, capture_output=True, text=True
        ).stdout
    )
    run([*COMPOSE, "up", "--build", "--detach", "--wait"], env=app_environment(status))
    print("App: http://uwaterloo.wat2do.localhost:3000")
    print("Login codes are sent to your email through Resend.")
    print("Code changes reload automatically. Use make stop to stop without deleting data.")


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(
            f"Local setup failed ({type(error).__name__}). Fix the reported issue and rerun; no automatic reset was attempted."
        ) from None
