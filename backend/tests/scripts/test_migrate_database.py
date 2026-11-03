"""scripts/migrate-database.sh against a fake psql that keeps its database in a JSON file.

The fake answers the runner's state queries and applies each write call as one
transaction: a failing file leaves the stored state untouched, as a rollback
would.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
RUNNER = REPO_ROOT / "scripts/migrate-database.sh"

FAKE_PSQL = """\
import json, os, re, sys

state_path = os.environ["FAKE_DATABASE"]
state = json.load(open(state_path))
commands = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--command=")]
files = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--file=")]
state["calls"].append({
    "commands": commands,
    "files": [os.path.basename(f) for f in files],
    "single_transaction": "--single-transaction" in sys.argv,
    "pgoptions": os.environ.get("PGOPTIONS", ""),
})

def save():
    json.dump(state, open(state_path, "w"))

if len(commands) == 1 and not files and commands[0].lstrip().startswith("SELECT"):
    save()
    sql = commands[0]
    flag = lambda value: "t" if value else "f"
    if "to_regclass" in sql:
        print(flag(state["history"] is not None), flag(state["supabase_history"] is not None),
              flag(state["has_schema"]))
    elif "FROM public.schema_migrations" in sql:
        print("\\n".join(row[0] for row in state["history"]))
    elif "FROM supabase_migrations.schema_migrations" in sql:
        print("\\n".join(row[0] for row in state["supabase_history"]))
    sys.exit(0)

calls = state["calls"]
for sql in commands:
    if "CREATE TABLE public.schema_migrations" in sql:
        if state["history"] is not None:
            sys.exit('ERROR: relation "schema_migrations" already exists')
        state["history"] = []
    elif "SELECT version, coalesce(name, '')" in sql:
        state["history"] += state["supabase_history"]
    elif sql.startswith("INSERT INTO public.schema_migrations"):
        for version, name in re.findall(r"\\('(\\d{14})', '([a-z0-9_]+)'\\)", sql):
            if version in [row[0] for row in state["history"]]:
                sys.exit("ERROR: duplicate key value violates unique constraint")
            state["history"].append([version, name])
for path in files:
    if os.path.basename(path) in state["fail_files"]:
        json.dump({**json.load(open(state_path)), "calls": calls}, open(state_path, "w"))
        sys.exit("ERROR: injected failure in " + os.path.basename(path))
    state["has_schema"] = True
    state["applied"].append(os.path.basename(path))
save()
"""


class FakeDatabase:
    def __init__(self, root: Path, migrations: list[str]):
        self.root = root
        (root / "scripts").mkdir()
        shutil.copy(RUNNER, root / "scripts/migrate-database.sh")
        self.database_dir = root / "backend/database"
        (self.database_dir / "migrations").mkdir(parents=True)
        for name in migrations:
            (self.database_dir / "migrations" / name).write_text("SELECT 1;\n")
        bin_dir = root / "bin"
        bin_dir.mkdir()
        psql = bin_dir / "psql"
        psql.write_text(f"#!{sys.executable}\n{FAKE_PSQL}")
        psql.chmod(0o755)
        self.path = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"
        self.state_path = root / "database.json"
        self.store(history=None, supabase_history=None, has_schema=False)

    def store(self, **changes):
        state = self.state() if self.state_path.exists() else {}
        state = {"calls": [], "applied": [], "fail_files": [], **state, **changes}
        self.state_path.write_text(json.dumps(state))

    def state(self) -> dict:
        return json.loads(self.state_path.read_text())

    def write_calls(self) -> list[dict]:
        return [
            call
            for call in self.state()["calls"]
            if call["files"]
            or len(call["commands"]) != 1
            or not call["commands"][0].lstrip().startswith("SELECT")
        ]

    def migrate(self, *arguments: str, script: Path | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(script or self.root / "scripts/migrate-database.sh"), *arguments],
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "PATH": self.path,
                "DATABASE_URL": "postgresql://fake/wat2do",
                "FAKE_DATABASE": str(self.state_path),
            },
            cwd=self.root,
        )


FIRST = "20260101000000_first.sql"
SECOND = "20260201000000_second.sql"
THIRD = "20260301000000_third.sql"


@pytest.fixture
def database(tmp_path):
    return FakeDatabase(tmp_path, [THIRD, FIRST, SECOND])


def history_versions(database: FakeDatabase) -> list[str]:
    return [version for version, _ in database.state()["history"]]


def test_first_run_copies_supabase_history_and_applies_only_new_files(database):
    database.store(
        supabase_history=[["20260101000000", "first"], ["20260201000000", "second"]],
        has_schema=True,
    )
    result = database.migrate()
    assert result.returncode == 0, result.stderr
    assert "copying the 2 migrations the Supabase CLI applied" in result.stdout
    assert database.state()["applied"] == [THIRD]
    assert database.state()["history"] == [
        ["20260101000000", "first"],
        ["20260201000000", "second"],
        ["20260301000000", "third"],
    ]
    seeding, applying = database.write_calls()
    assert seeding["single_transaction"] and "CREATE TABLE" in seeding["commands"][0]
    # The record is written in the same transaction as, and before, the file.
    assert applying["single_transaction"]
    assert applying["commands"][0].startswith("INSERT INTO public.schema_migrations")
    assert "'20260301000000', 'third'" in applying["commands"][0]
    assert applying["files"] == [THIRD]


def test_second_run_applies_nothing(database):
    database.store(supabase_history=[["20260101000000", "first"]], has_schema=True)
    assert database.migrate().returncode == 0
    result = database.migrate()
    assert result.returncode == 0, result.stderr
    assert "No pending migrations." in result.stdout
    assert database.state()["applied"] == [SECOND, THIRD]


def test_dry_run_lists_pending_files_without_writing(database):
    database.store(supabase_history=[["20260101000000", "first"]], has_schema=True)
    result = database.migrate("--dry-run")
    assert result.returncode == 0, result.stderr
    assert f"  {SECOND}\n  {THIRD}\n" in result.stdout
    assert database.write_calls() == []
    assert database.state()["history"] is None
    calls = database.state()["calls"]
    assert calls and all("default_transaction_read_only=on" in c["pgoptions"] for c in calls)


def test_recorded_version_without_file_is_refused(database):
    database.store(
        history=[["20260101000000", "first"], ["20260115000000", "deleted"]], has_schema=True
    )
    result = database.migrate()
    assert result.returncode != 0
    assert "no file in backend/database/migrations" in result.stderr
    assert "20260115000000" in result.stderr
    assert database.write_calls() == []


def test_migration_dated_before_the_newest_applied_one_is_refused(database):
    database.store(
        history=[["20260101000000", "first"], ["20260301000000", "third"]], has_schema=True
    )
    result = database.migrate()
    assert result.returncode != 0
    assert "20260201000000" in result.stderr
    assert "Rename each to a version after 20260301000000" in result.stderr
    assert database.write_calls() == []


def test_failed_migration_stops_the_run_unrecorded(database):
    database.store(history=[["20260101000000", "first"]], has_schema=True, fail_files=[SECOND])
    result = database.migrate()
    assert result.returncode != 0
    assert database.state()["applied"] == []
    assert history_versions(database) == ["20260101000000"]


def test_empty_database_starts_from_baseline(database):
    (database.database_dir / "baseline.sql").write_text(
        "-- baseline-version: 20260201000000\n-- Generated.\n\nCREATE TABLE public.schools ();\n"
    )
    result = database.migrate()
    assert result.returncode == 0, result.stderr
    assert "every migration through 20260201000000" in result.stdout
    baseline, applying = database.write_calls()
    assert baseline["single_transaction"]
    assert "CREATE TABLE public.schema_migrations" in baseline["commands"][0]
    assert "('20260101000000', 'first'), ('20260201000000', 'second')" in baseline["commands"][1]
    assert baseline["files"] == ["baseline.sql"]
    assert applying["files"] == [THIRD]
    assert history_versions(database) == ["20260101000000", "20260201000000", "20260301000000"]


def test_baseline_without_version_header_is_refused(database):
    (database.database_dir / "baseline.sql").write_text("-- Generated.\nCREATE TABLE x ();\n")
    result = database.migrate()
    assert result.returncode != 0
    assert "no '-- baseline-version: <version>' header" in result.stderr
    assert database.write_calls() == []


def test_empty_database_without_baseline_applies_every_migration(database):
    result = database.migrate()
    assert result.returncode == 0, result.stderr
    assert "baseline.sql does not exist yet" in result.stdout
    assert database.state()["applied"] == [FIRST, SECOND, THIRD]


@pytest.mark.parametrize("history", [None, []])
def test_schema_without_history_is_refused(database, history):
    database.store(history=history, has_schema=True)
    result = database.migrate()
    assert result.returncode != 0
    assert "migration state is unknown" in result.stderr
    assert database.write_calls() == []


@pytest.mark.parametrize(
    "name", ["20260401000000-dash.sql", "2026040100_short.sql", "20260401000000_Upper.sql"]
)
def test_misnamed_migration_file_is_refused(database, name):
    (database.database_dir / "migrations" / name).write_text("SELECT 1;\n")
    result = database.migrate("--dry-run")
    assert result.returncode != 0
    assert f"{name} is not named" in result.stderr


def test_duplicate_versions_are_refused(database):
    (database.database_dir / "migrations" / "20260201000000_twin.sql").write_text("SELECT 1;\n")
    result = database.migrate("--dry-run")
    assert result.returncode != 0
    assert "share a version" in result.stderr


def test_repository_migrations_are_named_for_the_runner(database):
    """Every committed migration has a unique, quotable version and name."""
    versions = [
        [path.name[:14], path.stem[15:]]
        for path in sorted((REPO_ROOT / "backend/database/migrations").glob("*.sql"))
    ]
    database.store(history=versions, has_schema=True)
    result = database.migrate("--dry-run", script=RUNNER)
    assert result.returncode == 0, result.stderr
    assert "No pending migrations." in result.stdout
