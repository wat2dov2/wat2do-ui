"""One local lifecycle for the development database, data API and app services."""

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The local backend's access-token signing key, made once and kept out of git.
DEV_SIGNING_KEY = ROOT / "backend" / ".dev-auth-signing-key"
COMPOSE = ["docker", "compose", "-p", "wat2do-dev", "-f", str(ROOT / "docker-compose.dev.yml")]
# Services that use the database; a reset stops them first.
DATABASE_CLIENTS = ["data-api", "backend", "frontend"]
# docker-compose.dev.yml mounts the repository at /workspace in the database
# container, whose POSTGRES_* settings name the local database.
LOCAL_DATABASE_URL = "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost/$POSTGRES_DB"
PSQL = f'psql "{LOCAL_DATABASE_URL}" --no-psqlrc -v ON_ERROR_STOP=1'


def run(command, *, cwd=ROOT, **kwargs):
    return subprocess.run(command, cwd=cwd, check=True, **kwargs)


def dev_signing_key() -> str:
    if not DEV_SIGNING_KEY.exists():
        key = run(
            "openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform DER | base64",
            shell=True,
            capture_output=True,
            text=True,
        ).stdout
        DEV_SIGNING_KEY.write_text("".join(key.split()))
    return DEV_SIGNING_KEY.read_text().strip()


def in_database_container(script):
    run([*COMPOSE, "exec", "-T", "database", "sh", "-c", script])


def start_database():
    run([*COMPOSE, "up", "--build", "--detach", "--wait", "database"])


def recreate_database():
    in_database_container(
        'dropdb --username="$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"'
        ' && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'
    )


def migrate():
    in_database_container(f"{PSQL} --quiet -f /workspace/backend/database/local-roles.sql")
    in_database_container(
        f'DATABASE_URL="{LOCAL_DATABASE_URL}" bash /workspace/scripts/migrate-database.sh'
    )


def seed():
    in_database_container(f"{PSQL} -f /workspace/backend/database/seed.sql")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["dev", "seed", "stop", "db-reset"])
    action = parser.parse_args().action
    if not shutil.which("docker"):
        parser.error("Install docker first. See README.md.")
    run(["docker", "info"], stdout=subprocess.DEVNULL)
    os.environ["DEV_AUTH_SIGNING_KEY"] = dev_signing_key()

    if action == "seed":
        seed()
        return
    if action == "stop":
        run([*COMPOSE, "down"])
        return
    if action == "db-reset":
        if input("Delete ALL local database data and reseed? Type RESET: ") != "RESET":
            parser.error("Reset cancelled; no data changed.")
        run([*COMPOSE, "stop", *DATABASE_CLIENTS])
        start_database()
        recreate_database()
        migrate()
        seed()
        return

    compose_config = json.loads(
        run([*COMPOSE, "config", "--format", "json"], capture_output=True, text=True).stdout
    )
    backend_environment = compose_config["services"]["backend"]["environment"]
    if not all(
        (backend_environment.get(name) or "").strip()
        for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")
    ):
        parser.error(
            "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for SES in backend/.env first."
        )

    print("Starting the local database...", flush=True)
    start_database()
    migrate()
    seed()
    run([*COMPOSE, "up", "--build", "--detach", "--wait"])
    print("App: http://uwaterloo.wat2do.localhost:3000")
    print("Login codes are sent to your email through Amazon SES.")
    print("Code changes reload automatically. Use make stop to stop without deleting data.")


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(
            f"Local setup failed ({type(error).__name__}). Fix the reported issue and rerun; no automatic reset was attempted."
        ) from None
