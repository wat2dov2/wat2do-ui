"""Write the daily report: Opus reads the day's complaints and suggests changes to wat2do.io.

It runs after each sweep. The agent gets the complaints as a file and a copy of
wat2do's own site and API code, so it can check what wat2do already does and
point to where a change belongs. It reads only those files; it never edits code
or opens the web. Cited links outside the day's complaints are dropped.

The same run keeps the feature backlog: the agent also gets the backlog and the
recent reports' suggestions, and returns the features to add or rewrite, each
scored on five dimensions. A feature keeps every complaint ever cited for it.
"""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from core.controlbox import controlbox
from schemas.competitor_pain_point import (
    CompetitorPainPointResponse,
    DailyReport,
    FeatureUpdate,
    PainPointFeature,
    ReportSuggestion,
    ReportTheme,
)
from services.claude_code import run_agent
from services.competitor_pain_points import service

log = logging.getLogger(__name__)
CONTROL = controlbox.competitor_pain_points
PROMPT = (Path(__file__).with_name("report_prompt.md")).read_text()
REPOSITORY = Path(__file__).resolve().parents[3]
WORKDIR_PREFIX = "wat2do-pain-point-report-"
MAX_SUGGESTIONS = 8
# The past reports whose suggestions the backlog is built from, and the most
# complaint links a feature keeps (the newest win).
PAST_REPORTS = 60
MAX_FEATURE_URLS = 200
# The code the agent may read: the site, minus translations other than English
# and generated files, and the API routes (Rust, and the routers still in Python).
# No secrets live in any of them.
CODE_FOLDERS = ("frontend/src", "rust/src/api/routes", "backend/routers")
_SKIPPED_CODE = shutil.ignore_patterns("generated", "*.test.*", "*.spec.*", "__pycache__")

_TEXT = {"type": "string"}
_URLS = {"type": "array", "items": _TEXT}
_SCORE = {"type": "integer", "minimum": 1, "maximum": 5}
SCORES = ("demand", "pain", "fit", "edge", "ease")
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": _TEXT,
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "theme": _TEXT,
                    "detail": _TEXT,
                    "competitors": {"type": "array", "items": _TEXT},
                    "complaint_urls": _URLS,
                },
                "required": ["theme", "detail", "competitors", "complaint_urls"],
            },
        },
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": _TEXT,
                    "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                    "problem": _TEXT,
                    "change": _TEXT,
                    "where": {"type": "array", "items": _TEXT},
                    "complaint_urls": _URLS,
                },
                "required": ["title", "priority", "problem", "change", "where", "complaint_urls"],
            },
        },
        "features": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": _TEXT,
                    "title": _TEXT,
                    "problem": _TEXT,
                    "change": _TEXT,
                    "where": {"type": "array", "items": _TEXT},
                    "audience": {"type": "string", "enum": ["organizer", "attendee", "both"]},
                    "status": {"type": "string", "enum": ["open", "built"]},
                    **{score: _SCORE for score in SCORES},
                    "rationale": _TEXT,
                    "competitors": {"type": "array", "items": _TEXT},
                    "complaint_urls": _URLS,
                },
                "required": [
                    "key",
                    "title",
                    "problem",
                    "change",
                    "where",
                    "audience",
                    "status",
                    *SCORES,
                    "rationale",
                    "competitors",
                    "complaint_urls",
                ],
            },
        },
    },
    "required": ["summary", "themes", "suggestions", "features"],
}


def write_daily_report() -> DailyReport | None:
    """Report on the complaints found in the last window; None when there were none."""
    now = datetime.now().astimezone()
    complaints = service.found_since(
        now - timedelta(hours=CONTROL.report_window_hours), CONTROL.report_max_complaints
    )
    if not complaints:
        log.info("No new complaints to report on")
        return None
    backlog = service.all_features()
    past = service.recent_reports(PAST_REPORTS)
    workdir = tempfile.mkdtemp(prefix=WORKDIR_PREFIX)
    try:
        _write_inputs(Path(workdir), complaints, backlog, past)
        answer = run_agent(
            _prompt(len(complaints)),
            workdir=workdir,
            model=CONTROL.report_model,
            tools=("Read", "Grep", "Glob"),
            allowed_tools=("Read(./**)", "Grep(./**)", "Glob(./**)"),
            schema=ANSWER_SCHEMA,
            timeout=CONTROL.report_timeout_seconds,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    report = _report(answer, complaints, now)
    service.save_report(report)
    features = _features(answer, backlog, _citable(complaints, backlog, past), report.report_date)
    service.save_features(features)
    log.info(
        "Daily report for %s: %d complaints, %d suggestions, %d features added or changed",
        report.report_date,
        report.complaint_count,
        len(report.suggestions),
        len(features),
    )
    return report


def _write_inputs(
    workdir: Path,
    complaints: list[CompetitorPainPointResponse],
    backlog: list[PainPointFeature],
    past: list[DailyReport],
) -> None:
    rows = [
        {
            "url": c.url,
            "competitor": CONTROL.competitors.get(c.competitor, c.competitor),
            "source": c.source,
            "audience": c.audience,
            "pain_point": c.pain_point,
            "quote": c.quote,
            "posted_at": c.posted_at.isoformat() if c.posted_at else None,
        }
        for c in complaints
    ]
    (workdir / "complaints.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    features = [
        {
            **feature.model_dump(mode="json", exclude={"complaint_urls"}),
            "complaint_count": len(feature.complaint_urls),
        }
        for feature in backlog
    ]
    (workdir / "features.json").write_text(json.dumps(features, ensure_ascii=False, indent=1))
    suggestions = [
        {"report_date": r.report_date.isoformat(), **s.model_dump(mode="json")}
        for r in past
        for s in r.suggestions
    ]
    (workdir / "past_suggestions.json").write_text(
        json.dumps(suggestions, ensure_ascii=False, indent=1)
    )
    for folder in CODE_FOLDERS:
        shutil.copytree(REPOSITORY / folder, workdir / "wat2do" / folder, ignore=_skip_code)


def _skip_code(directory: str, names: list[str]) -> set[str]:
    skipped = set(_SKIPPED_CODE(directory, names))
    if Path(directory).name == "locales":
        skipped |= {name for name in names if name.endswith(".json") and name != "en.json"}
    return skipped


def _prompt(count: int) -> str:
    values = {
        "count": str(count),
        "window_hours": str(CONTROL.report_window_hours),
        "max_suggestions": str(MAX_SUGGESTIONS),
    }
    prompt = PROMPT
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt


def _report(
    answer: dict[str, Any], complaints: list[CompetitorPainPointResponse], now: datetime
) -> DailyReport:
    """The agent's answer, checked: invented links are dropped, and so is a
    suggestion left with no real complaint behind it."""
    real = {c.url for c in complaints}

    def cited(item: dict[str, Any]) -> dict[str, Any]:
        urls = item.get("complaint_urls") or []
        # Paths are relative to the agent's copy; the admin page wants repo paths.
        where = [str(place).removeprefix("wat2do/") for place in item.get("where") or []]
        return {**item, "where": where, "complaint_urls": [url for url in urls if url in real]}

    themes = _valid(ReportTheme, [cited(item) for item in answer.get("themes") or []])
    suggestions = [
        s
        for s in _valid(ReportSuggestion, [cited(i) for i in answer.get("suggestions") or []])
        if s.complaint_urls
    ]
    return DailyReport(
        report_date=now.date(),
        model=CONTROL.report_model,
        complaint_count=len(complaints),
        summary=answer.get("summary") or "",
        themes=themes[:20],
        suggestions=suggestions[:MAX_SUGGESTIONS],
    )


def _citable(
    complaints: list[CompetitorPainPointResponse],
    backlog: list[PainPointFeature],
    past: list[DailyReport],
) -> set[str]:
    """The complaint links a feature may cite: today's, and any a past report
    or the backlog already cited."""
    urls = {c.url for c in complaints}
    urls.update(url for feature in backlog for url in feature.complaint_urls)
    for report in past:
        for item in [*report.suggestions, *report.themes]:
            urls.update(item.complaint_urls)
    return urls


def _features(
    answer: dict[str, Any], backlog: list[PainPointFeature], citable: set[str], today: date
) -> list[PainPointFeature]:
    """The agent's added and rewritten features, merged into the backlog: a
    feature keeps every link it has cited, and its report count and last
    sighting move only when today's answer adds a link. A new feature with no
    real link behind it is dropped."""
    stored = {feature.key: feature for feature in backlog}
    merged: dict[str, PainPointFeature] = {}
    for update in _valid(FeatureUpdate, answer.get("features") or []):
        urls = [url for url in dict.fromkeys(update.complaint_urls) if url in citable]
        # Paths are relative to the agent's copy; the admin page wants repo paths.
        fields = {
            **update.model_dump(),
            "where": [str(place).removeprefix("wat2do/") for place in update.where],
        }
        old = stored.get(update.key)
        if old is None:
            if not urls:
                continue
            merged[update.key] = PainPointFeature(
                **{**fields, "complaint_urls": urls[-MAX_FEATURE_URLS:]},
                report_count=1,
                first_seen=today,
                last_seen=today,
            )
            continue
        added = [url for url in urls if url not in old.complaint_urls]
        merged[update.key] = PainPointFeature(
            **{
                **fields,
                "competitors": list(dict.fromkeys([*old.competitors, *update.competitors]))[:30],
                "complaint_urls": [*old.complaint_urls, *added][-MAX_FEATURE_URLS:],
            },
            report_count=old.report_count + (1 if added and old.last_seen != today else 0),
            first_seen=old.first_seen,
            last_seen=today if added else old.last_seen,
        )
    return list(merged.values())


def _valid[Model: BaseModel](model: type[Model], items: list[dict[str, Any]]) -> list[Model]:
    valid = []
    for item in items:
        try:
            valid.append(model.model_validate(item))
        except ValidationError:
            continue
    return valid
