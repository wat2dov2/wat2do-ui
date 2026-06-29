"""Tests for scrape school resolution."""

from __future__ import annotations

from services.scraper.school_resolution import DEFAULT_SCRAPE_SCHOOL, resolve_scrape_school


def test_resolve_scrape_school_prefers_explicit():
    assert resolve_scrape_school(explicit_school="McGill University") == "McGill University"


def test_resolve_scrape_school_uses_school_env(monkeypatch):
    monkeypatch.setenv("SCHOOL", "Queen's University")
    monkeypatch.delenv("TARGET_SCHOOL", raising=False)
    monkeypatch.delenv("INTENDED_RECIPIENT_ID", raising=False)
    assert resolve_scrape_school() == "Queen's University"


def test_resolve_scrape_school_uses_recipient_mapping(monkeypatch):
    monkeypatch.delenv("SCHOOL", raising=False)
    monkeypatch.delenv("TARGET_SCHOOL", raising=False)
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "76214170483")
    assert resolve_scrape_school() == "University of Waterloo"


def test_resolve_scrape_school_utm_recipient_mapping(monkeypatch):
    monkeypatch.delenv("SCHOOL", raising=False)
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", "78383689040")
    assert resolve_scrape_school() == "University of Toronto Mississauga"


def test_resolve_scrape_school_defaults_to_waterloo(monkeypatch):
    for key in ("SCHOOL", "TARGET_SCHOOL", "INTENDED_RECIPIENT_ID"):
        monkeypatch.delenv(key, raising=False)
    assert resolve_scrape_school() == DEFAULT_SCRAPE_SCHOOL


def test_resolve_scrape_school_explicit_overrides_env(monkeypatch):
    monkeypatch.setenv("SCHOOL", "York University")
    assert resolve_scrape_school(explicit_school="Western University") == "Western University"
