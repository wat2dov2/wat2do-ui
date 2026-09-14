from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import reconcile_duplicate_clubs as module


def _row(row_id, name, ig, school="utsc", logo_url=None):
    return {
        "id": row_id,
        "club_name": name,
        "ig": ig,
        "logo_url": logo_url,
        "school": {"slug": school},
    }


def _plan():
    return {
        "version": 1,
        "merges": [
            {
                "school": "utsc",
                "canonical": {
                    "id": 2,
                    "club_name": "Best Club UTSC",
                    "ig": "best.club",
                },
                "duplicates": [
                    {
                        "id": 1,
                        "club_name": "Best Club Student Chapter",
                        "ig": "bestclub.old",
                    }
                ],
            }
        ],
        "instagram_clears": [
            {
                "school": "utsc",
                "club": {
                    "id": 3,
                    "club_name": "Different Club",
                    "ig": "best.club",
                },
            }
        ],
    }


def test_validate_plan_rejects_an_club_in_multiple_actions():
    plan = _plan()
    plan["instagram_clears"][0]["club"]["id"] = 1

    with pytest.raises(ValueError, match="appears in multiple actions"):
        module.validate_plan(plan)


def test_build_plan_freezes_reviewed_rows(monkeypatch):
    rows = {
        1: _row(1, "Best Club Student Chapter", "@BestClub.Old"),
        2: _row(2, "Best Club UTSC", "best.club"),
        3: _row(3, "Different Club", "best.club"),
    }
    monkeypatch.setattr(module, "_fetch_current_rows", lambda sb, ids: rows)
    decisions = {
        "version": 1,
        "merges": [{"school": "utsc", "canonical_id": 2, "duplicate_ids": [1]}],
        "instagram_clears": [{"school": "utsc", "id": 3}],
    }

    assert module.build_plan(object(), decisions) == _plan()


def test_outstanding_plan_is_idempotent_and_rejects_partial_merge():
    plan = _plan()
    rows = {
        2: _row(2, "Best Club UTSC", "best.club"),
        3: _row(3, "Different Club", None),
    }

    assert module.outstanding_plan(plan, rows) == {
        "version": 1,
        "merges": [],
        "instagram_clears": [],
    }

    with pytest.raises(ValueError, match="partially applied"):
        module.outstanding_plan(plan, {1: _row(1, "Best Club Student Chapter", "bestclub.old")})


def test_validate_current_rows_detects_reviewed_metadata_drift():
    plan = _plan()
    rows = {
        1: _row(1, "Renamed Club", "bestclub.old"),
        2: _row(2, "Best Club UTSC", "best.club"),
        3: _row(3, "Different Club", "best.club"),
    }

    with pytest.raises(ValueError, match="changed since review"):
        module.validate_current_rows(plan, rows)


def test_build_transaction_sql_moves_dependencies_and_guards_reviewed_rows():
    sql = module.build_transaction_sql(_plan())

    assert "BEGIN;" in sql
    assert "pg_advisory_xact_lock" in sql
    assert "Club reconciliation plan no longer matches production" in sql
    assert "UPDATE events SET club_id = 2 WHERE club_id = 1" in sql
    assert "UPDATE positions SET club_id = 2 WHERE club_id = 1" in sql
    assert "NULLIF(canonical.club_type, 'independent')" in sql
    assert "Club merge 2 has conflicting club_memberships rows" in sql
    assert "UPDATE clubs SET ig = NULL, logo_url = NULL WHERE id = 3" in sql
    assert sql.rstrip().endswith("COMMIT;")


def test_run_transaction_passes_credentials_only_through_environment(monkeypatch):
    run = MagicMock(return_value=SimpleNamespace(returncode=0, stderr=""))
    monkeypatch.setattr(module.subprocess, "run", run)
    monkeypatch.setattr(module.shutil, "which", lambda executable: "/opt/homebrew/bin/psql")
    monkeypatch.setattr(
        module.settings,
        "database_url",
        "postgresql://db-user:secret@db.example.com:6543/postgres?sslmode=require",
    )

    module.run_transaction("BEGIN; COMMIT;")

    assert "secret" not in " ".join(run.call_args.args[0])
    assert run.call_args.kwargs["env"]["PGHOST"] == "db.example.com"
    assert run.call_args.kwargs["env"]["PGPORT"] == "6543"
    assert run.call_args.kwargs["env"]["PGUSER"] == "db-user"
    assert run.call_args.kwargs["env"]["PGPASSWORD"] == "secret"
    assert run.call_args.kwargs["env"]["PGDATABASE"] == "postgres"
    assert run.call_args.kwargs["env"]["PGSSLMODE"] == "require"
    assert run.call_args.kwargs["input"] == "BEGIN; COMMIT;"


def test_delete_unreferenced_logos_preserves_referenced_objects(monkeypatch):
    query = MagicMock()
    query.select.return_value = query
    query.eq.return_value = query
    query.limit.return_value = query
    query.execute.side_effect = [
        SimpleNamespace(data=[{"id": 1}]),
        SimpleNamespace(data=[]),
    ]
    sb = MagicMock()
    sb.table.return_value = query
    path_from_url = MagicMock(return_value="orphan.jpg")
    delete_file = MagicMock()
    monkeypatch.setattr(module.storage, "path_from_url", path_from_url)
    monkeypatch.setattr(module.storage, "delete_file", delete_file)

    deleted = module.delete_unreferenced_logos(
        sb,
        {
            "https://wat2do.io/media/organization-logos/kept.jpg",
            "https://wat2do.io/media/organization-logos/orphan.jpg",
        },
    )

    assert deleted == 1
    path_from_url.assert_called_once_with(
        "https://wat2do.io/media/organization-logos/orphan.jpg",
        module.BUCKET_CLUB_LOGOS,
    )
    delete_file.assert_called_once_with(
        module.BUCKET_CLUB_LOGOS,
        "orphan.jpg",
    )
