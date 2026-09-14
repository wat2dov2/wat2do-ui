#!/usr/bin/env python3
"""Use search-engine results to enrich missing Instagram handles in the master xlsx.

The script is intentionally conservative: it only writes a result when the
Instagram profile candidate matches both the club name and school context.

Usage:
  python backend/scripts/search_missing_instagrams.py --limit 25
  python backend/scripts/search_missing_instagrams.py --schools UManitoba --apply
  python backend/scripts/search_missing_instagrams.py --apply
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen

import openpyxl

log = logging.getLogger(__name__)

XLSX_PATH = Path(__file__).resolve().parent.parent / "services" / "scraper" / "wat2do-clubs.xlsx"
OUT_PATH = Path("/tmp/claude/web-search-instagram-matches.json")

IG_RE = re.compile(r"https?://(?:www\.)?instagram\.com/([A-Za-z0-9_.]+)", re.I)
PROFILE_SKIP = frozenset(
    {
        "about",
        "accounts",
        "developer",
        "explore",
        "instagram",
        "legal",
        "p",
        "privacy",
        "reel",
        "stories",
        "terms",
    }
)
COMMON_TOKENS = frozenset(
    {
        "a",
        "aka",
        "all",
        "and",
        "at",
        "club",
        "college",
        "for",
        "group",
        "inc",
        "of",
        "on",
        "club",
        "society",
        "student",
        "students",
        "the",
        "university",
    }
)
SCHOOL_ALIASES: dict[str, tuple[str, ...]] = {
    "Brock": ("brock", "brocku", "brock university"),
    "Carleton": ("carleton", "carletonu", "carleton university"),
    "Concordia": ("concordia", "concordia university"),
    "Cornell": ("cornell", "cornell university"),
    "Laurier": ("laurier", "wlu", "wilfrid laurier"),
    "McGill": ("mcgill", "mcgill university"),
    "McMaster": ("mcmaster", "mac", "mcmaster university"),
    "Memorial": ("memorial", "mun", "memorial university"),
    "NYU": ("nyu", "new york university"),
    "Queen's": ("queens", "queen's", "queen's university"),
    "SFU": ("sfu", "simon fraser"),
    "TMU": ("tmu", "toronto metropolitan"),
    "UAlberta": ("ualberta", "uofa", "university of alberta"),
    "UBC": ("ubc", "university of british columbia"),
    "UCalgary": ("ucalgary", "university of calgary"),
    "UManitoba": ("umanitoba", "uofm", "university of manitoba"),
    "UPenn": ("upenn", "penn", "university of pennsylvania"),
    "UofT Scarborough": ("utsc", "uoft scarborough", "university of toronto scarborough"),
    "UofT St. George": ("uoft", "utsg", "university of toronto"),
    "Western": ("westernu", "uwo", "western university"),
    "York": ("yorku", "york university"),
    "uOttawa": ("uottawa", "u of ottawa", "university of ottawa"),
}
GLOBAL_SCHOOL_HANDLES = frozenset(
    {
        "brocku",
        "carleton_u",
        "concordiauniversity",
        "cornelluniversity",
        "mcgillu",
        "mcmasteru",
        "memorialuniversity",
        "nyuniversity",
        "queensuniversity",
        "simonfraseru",
        "torontomet",
        "ualberta",
        "ubc",
        "ucalgary",
        "umanitoba",
        "uottawa",
        "uoft",
        "upenn",
        "westernuniversity",
        "wilfridlaurieruni",
        "yorkuniversity",
    }
)


@dataclass
class SheetRow:
    row_idx: int
    school: str
    name: str
    directory_url: str | None


@dataclass
class Match:
    row_idx: int
    school: str
    name: str
    instagram_url: str
    instagram_handle: str
    score: int
    query: str
    evidence: str


def normalize(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def tokens(value: str | None) -> list[str]:
    return [t for t in normalize(value).split() if len(t) > 2 and t not in COMMON_TOKENS]


def canonical_ig(url: str) -> tuple[str | None, str | None]:
    match = IG_RE.search(url)
    if not match:
        return None, None
    handle = match.group(1).strip("/").lower()
    if not handle or handle in PROFILE_SKIP:
        return None, None
    return f"https://www.instagram.com/{handle}/", f"@{handle}"


def is_global_school_handle(handle: str | None) -> bool:
    if not handle:
        return False
    return handle.lstrip("@").lower() in GLOBAL_SCHOOL_HANDLES


def _decode_search_redirect(url: str) -> str:
    if "bing.com/ck/a" in url:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        if qs.get("u"):
            return unquote(qs["u"][0])
    if "r.search.yahoo.com" in url:
        match = re.search(r"/RU=(.*?)/(?:RK|RS)=", url)
        if match:
            return unquote(match.group(1))
    return url


def result_urls_from_html(body: str) -> list[tuple[str, str]]:
    """Return candidate URLs with nearby result text from a search result page."""
    results: list[tuple[str, str]] = []
    for block in re.findall(r"<li class=\"b_algo\".*?</li>", body, flags=re.I | re.S):
        urls = re.findall(r'href="([^"]+)"', block, flags=re.I)
        text = normalize(html.unescape(re.sub(r"<[^>]+>", " ", block)))
        for raw_url in urls:
            url = _decode_search_redirect(html.unescape(raw_url))
            if "instagram.com" in url:
                results.append((url, text))
    if results:
        return results

    # Fallback for result pages where the engine uses different result markup.
    for match in re.finditer(r'href="([^"]*instagram[^"]*)"', body, flags=re.I):
        raw_url = html.unescape(match.group(1))
        url = _decode_search_redirect(raw_url)
        start = max(0, match.start() - 500)
        end = min(len(body), match.end() + 500)
        text = normalize(html.unescape(re.sub(r"<[^>]+>", " ", body[start:end])))
        results.append((url, text))

    for match in re.finditer(r"https?://(?:www\.)?instagram\.com/[A-Za-z0-9_.]+", body, flags=re.I):
        start = max(0, match.start() - 500)
        end = min(len(body), match.end() + 500)
        text = normalize(html.unescape(re.sub(r"<[^>]+>", " ", body[start:end])))
        results.append((match.group(0), text))
    return results


def score_candidate(row: SheetRow, url: str, evidence: str) -> int:
    ig_url, handle = canonical_ig(url)
    if not ig_url or not handle:
        return 0
    handle_text = normalize(handle)
    evidence_text = normalize(f"{url} {evidence}")
    name_tokens = tokens(row.name)
    if not name_tokens:
        return 0

    score = 0
    token_hits = sum(1 for token in name_tokens if token in evidence_text or token in handle_text)
    distinctive = [token for token in name_tokens if len(token) >= 5]
    distinctive_hits = sum(
        1 for token in distinctive if token in evidence_text or token in handle_text
    )

    score += token_hits * 8
    score += distinctive_hits * 5
    if token_hits >= min(2, len(name_tokens)):
        score += 20
    if distinctive and distinctive_hits >= min(2, len(distinctive)):
        score += 15

    aliases = SCHOOL_ALIASES.get(row.school, (row.school,))
    alias_hits = sum(
        1
        for alias in aliases
        if normalize(alias) in evidence_text or normalize(alias) in handle_text
    )
    if alias_hits:
        score += 25

    # Handles often encode school + acronym but snippets encode the full club.
    initials = "".join(token[0] for token in name_tokens if token)
    raw_initials = "".join(
        token[0]
        for token in normalize(row.name).split()
        if len(token) > 1 and token not in {"at", "of", "the", "university"}
    )
    acronym_hit = False
    if len(initials) >= 3 and initials in handle_text.replace(" ", ""):
        acronym_hit = True
        score += 10
    if len(raw_initials) >= 3 and raw_initials in handle_text.replace(" ", ""):
        acronym_hit = True
        score += 25

    if (
        row.directory_url
        and urlparse(row.directory_url).netloc.replace("www.", "") in evidence_text
    ):
        score += 10

    # Accept acronym-style handles only when the handle also carries school context.
    if token_hits == 0 and not (acronym_hit and alias_hits):
        return 0
    if not alias_hits and token_hits < min(3, len(name_tokens)):
        return 0
    return score


def search(query: str, timeout: int) -> str:
    url = f"https://search.yahoo.com/search?p={quote_plus(query)}"
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
            )
        },
    )
    with urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_instagram_profile_text(url: str, timeout: int) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
            )
        },
    )
    with urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8", "ignore")
    chunks = re.findall(
        r'<meta[^>]+(?:property|name)="(?:og:title|og:description|description)"[^>]+content="([^"]*)"',
        body,
        flags=re.I,
    )
    chunks += re.findall(
        r'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:og:title|og:description|description)"',
        body,
        flags=re.I,
    )
    if not chunks:
        return normalize(html.unescape(re.sub(r"<[^>]+>", " ", body[:20000])))
    return normalize(" ".join(html.unescape(chunk) for chunk in chunks))


def queries_for(row: SheetRow) -> list[str]:
    aliases = SCHOOL_ALIASES.get(row.school, (row.school,))
    queries: list[str] = []
    for alias in aliases[:3]:
        queries.append(f'site:instagram.com "{row.name}" "{alias}"')
        queries.append(f'"{row.name}" "{alias}" Instagram')
    queries.append(f'"{row.name}" "{row.school}" Instagram')
    return queries


def find_match(row: SheetRow, delay: float, timeout: int) -> Match | None:
    best: Match | None = None
    seen_urls: set[str] = set()
    profile_cache: dict[str, str] = {}
    for query in queries_for(row):
        try:
            body = search(query, timeout=timeout)
        except Exception as exc:
            log.debug("Search failed for %s / %s: %s", row.name, query, exc)
            time.sleep(delay)
            continue
        for url, evidence in result_urls_from_html(body):
            ig_url, handle = canonical_ig(url)
            if not ig_url or not handle or ig_url in seen_urls:
                continue
            if is_global_school_handle(handle):
                continue
            seen_urls.add(ig_url)
            search_score = score_candidate(row, ig_url, evidence)
            if search_score < 30:
                continue
            profile_text = profile_cache.get(ig_url)
            if profile_text is None:
                try:
                    profile_text = fetch_instagram_profile_text(ig_url, timeout=timeout)
                except Exception:
                    profile_text = ""
                profile_cache[ig_url] = profile_text
            score = score_candidate(row, ig_url, f"{evidence} {profile_text}")
            if score < 70 and search_score < 85:
                continue
            if best is None or score > best.score:
                best = Match(
                    row_idx=row.row_idx,
                    school=row.school,
                    name=row.name,
                    instagram_url=ig_url,
                    instagram_handle=handle,
                    score=score,
                    query=query,
                    evidence=f"{evidence} {profile_text}"[:400],
                )
        if best and best.score >= 75:
            return best
        time.sleep(delay)
    return best


def load_missing_rows(xlsx_path: Path, schools: set[str] | None) -> list[SheetRow]:
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    rows: list[SheetRow] = []
    for idx, raw in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        if not raw or not raw[0] or not raw[1]:
            continue
        school = str(raw[0]).strip()
        if schools and school not in schools:
            continue
        if raw[5]:
            continue
        rows.append(
            SheetRow(
                row_idx=idx,
                school=school,
                name=str(raw[1]).strip(),
                directory_url=str(raw[4]).strip() if raw[4] else None,
            )
        )
    wb.close()
    return rows


def update_workbook(xlsx_path: Path, matches: list[Match]) -> None:
    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.active
    for match in matches:
        ws.cell(row=match.row_idx, column=6, value=match.instagram_url)
        ws.cell(row=match.row_idx, column=7, value=match.instagram_handle)
        ws.cell(row=match.row_idx, column=8, value=f"confirmed|web_search|score={match.score}")

    row_count = ws.max_row - 2
    ig_count = sum(1 for row in range(3, ws.max_row + 1) if ws.cell(row=row, column=6).value)
    discord_count = sum(1 for row in range(3, ws.max_row + 1) if ws.cell(row=row, column=9).value)
    ws.cell(
        row=1,
        column=1,
        value=(
            f"Master list - {row_count:,} student clubs. "
            f"Instagram URLs: {ig_count:,}. Discord URLs: {discord_count:,}. "
            "SPA merge sources: web_search."
        ),
    )
    wb.save(xlsx_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", type=Path, default=XLSX_PATH)
    parser.add_argument("--schools", nargs="*", help="School slugs to include (e.g. ubc utsg wlu)")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    schools = set(args.schools) if args.schools else None
    rows = load_missing_rows(args.xlsx, schools)
    if args.limit is not None:
        rows = rows[: args.limit]

    log.info("Searching %s missing Instagram rows", len(rows))
    matches: list[Match] = []
    errors: list[dict[str, str]] = []
    for i, row in enumerate(rows, start=1):
        try:
            match = find_match(row, delay=args.delay, timeout=args.timeout)
        except Exception as exc:  # Search engines may occasionally throttle.
            errors.append({"row": str(row.row_idx), "name": row.name, "error": repr(exc)})
            log.warning("[%s/%s] ERROR %s: %s", i, len(rows), row.name, exc)
            time.sleep(max(args.delay, 1.0))
            continue
        if match:
            matches.append(match)
            log.info(
                "[%s/%s] MATCH %s | %s | %s",
                i,
                len(rows),
                row.school,
                row.name,
                match.instagram_handle,
            )
        else:
            log.info("[%s/%s] no match %s | %s", i, len(rows), row.school, row.name)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {
                "matches": [match.__dict__ for match in matches],
                "errors": errors,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    log.info("Wrote %s matches and %s errors to %s", len(matches), len(errors), args.out)

    if args.apply and matches:
        update_workbook(args.xlsx, matches)
        log.info("Applied %s matches to %s", len(matches), args.xlsx)
    elif not args.apply:
        log.info("Dry run only. Re-run with --apply to update the xlsx.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
