"""One-off Playwright scraper for SPA-based club directories.

Writes ``spa-{school}.json`` files (see ``merge_spa_output.SPA_FILES``) that
`merge_spa_output.py` merges into the master xlsx.

Usage:
    pip install playwright
    python -m playwright install chromium
    python backend/scripts/spa_scrape.py --school all --with-details
    # Outputs: /tmp/claude/spa-ubc.json /tmp/claude/spa-ualberta.json /tmp/claude/spa-ucalgary.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode

import openpyxl
from playwright.async_api import BrowserContext, Page, async_playwright

OUT_DIR = Path("/tmp/claude")
OUT_DIR.mkdir(parents=True, exist_ok=True)
XLSX_PATH = Path(__file__).resolve().parent.parent / "services" / "scraper" / "wat2do-clubs.xlsx"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

IG_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]+)")
DISCORD_INVITE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?discord\.gg/([A-Za-z0-9_-]+)"
    r"|(?:https?://)?(?:www\.)?discord\.com/invite/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)
DISCORD_SKIP_SLUGS = frozenset(
    {"invite", "channels", "login", "register", "developers", "terms", "privacy"}
)

# UMSU embeds its own union-wide social accounts in every club page footer.
UMSU_GLOBAL_IG = frozenset({"myumsu", "studentsofumsu"})

# amsclubs.ca directory chrome, not student clubs.
AMS_SKIP_SLUGS = frozenset(
    {
        "login",
        "contact",
        "all-clubs",
        "all-events",
        "clubs-login",
        "wp-content",
    }
)


def canon_ig(url: str | None) -> tuple[str | None, str | None]:
    if not url:
        return None, None
    m = IG_RE.search(url)
    if not m:
        return None, None
    slug = m.group(1).strip("/")
    if not slug or slug in {"p", "reel", "explore", "accounts", "stories"}:
        return None, None
    return f"https://www.instagram.com/{slug}/", f"@{slug}"


def canon_discord(url: str | None) -> str | None:
    if not url:
        return None
    m = DISCORD_INVITE_RE.search(url.strip())
    if not m:
        return None
    code = (m.group(1) or m.group(2) or "").strip()
    if not code or code.lower() in DISCORD_SKIP_SLUGS:
        return None
    return f"https://discord.gg/{code}"


def _empty_social_row() -> dict:
    return {
        "Instagram URL": None,
        "Instagram Handle": None,
        "IG Source": "not_searched",
        "Discord URL": None,
        "Discord Source": "not_searched",
    }


def _normalize_name(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _candidate_search_terms(name: str) -> list[str]:
    terms: list[str] = []

    def add(term: str) -> None:
        normalized = _normalize_name(term)
        if normalized and normalized not in terms:
            terms.append(normalized)

    add(name)
    cleaned = re.sub(
        r"^(ubc|sfu|um|umanitoba|concordia|memorial)\s+",
        "",
        name,
        flags=re.IGNORECASE,
    )
    add(cleaned)
    add(re.sub(r"\s*-\s*sfu$", "", cleaned, flags=re.IGNORECASE))
    add(
        re.sub(
            r"\b(club|society|association|student association)\b", "", cleaned, flags=re.IGNORECASE
        )
    )
    return [t for t in terms if len(t) >= 3]


def _load_seed_rows_from_xlsx(school: str) -> list[dict]:
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb.active
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for raw in ws.iter_rows(min_row=3, values_only=True):
        if not raw or raw[0] != school:
            continue
        name = (raw[1] or "").strip() if isinstance(raw[1], str) else raw[1]
        url = (raw[4] or "").strip() if isinstance(raw[4], str) else raw[4]
        if not name or not url:
            continue
        key = (str(name).strip(), str(url).strip())
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "name": str(name).strip(),
                "category": str(raw[2]).strip() if raw[2] else None,
                "campus": str(raw[3]).strip() if raw[3] else None,
                "url": str(url).strip(),
            }
        )
    wb.close()
    return rows


def _slug_to_title(slug: str) -> str:
    return slug.replace("_", " ").replace("-", " ").strip().title()


def _clean_list_name(raw: str | None, slug: str) -> str:
    text = re.sub(r"\s+", " ", (raw or "").strip())
    if not text:
        return _slug_to_title(slug)
    first_line = text.split("\n", 1)[0].strip()
    if len(first_line) <= 120:
        return first_line
    return _slug_to_title(slug)


async def _click_load_more(page: Page) -> bool:
    """Click a visible LOAD MORE / Show more control if present."""
    return bool(
        await page.evaluate(
            r"""() => {
                const btn = [...document.querySelectorAll('button, a, [role=button]')].find((el) =>
                    /load more|show more/i.test((el.innerText || el.textContent || '').trim())
                );
                if (!btn) return false;
                btn.click();
                return true;
            }"""
        )
    )


async def _harvest_campuslabs_org_links(page: Page) -> list[dict]:
    rows = await page.evaluate(
        r"""() => {
            const seen = new Map();
            for (const a of document.querySelectorAll('a[href*="/engage/organization/"]')) {
                const href = a.href.split('?')[0].replace(/\/$/, '');
                const m = href.match(/\/engage\/organization\/([^/]+)/);
                if (!m) continue;
                const slug = m[1];
                if (seen.has(slug)) continue;
                const text = (a.innerText || a.textContent || '').trim();
                seen.set(slug, { slug, name: text, url: href + '/' });
            }
            return Array.from(seen.values());
        }"""
    )
    clubs = []
    for row in rows:
        slug = row["slug"]
        clubs.append(
            {
                "name": _clean_list_name(row.get("name"), slug),
                "url": row["url"],
                "category": None,
            }
        )
    return clubs


async def _select_ualberta_filters(page: Page) -> None:
    """Use the Rubric location + university pickers like a human would."""
    await page.get_by_placeholder("Select Location...").click()
    await page.wait_for_timeout(800)
    await (
        page.locator("#select-country-modal")
        .get_by_text("Alberta, Canada", exact=False)
        .first.click()
    )
    await page.wait_for_timeout(2500)
    await page.get_by_placeholder("Select University").click()
    await page.wait_for_timeout(800)
    await page.locator(".modal.is-active").get_by_text("University of Alberta", exact=True).click()
    await page.wait_for_timeout(2500)


async def _fetch_ualberta_societies(ctx: BrowserContext, page: Page) -> list[dict]:
    """After UI filters are set, page through the same search API the SPA uses."""
    societies: dict[str, dict] = {}
    offset = 0
    total = None
    while True:
        payload = await ctx.request.post(
            "https://api.hellorubric.com/",
            data=urlencode(
                {
                    "details": json.dumps(
                        {
                            "firstCall": False,
                            "sortType": "itemName",
                            "desiredType": "societies",
                            "limit": 12,
                            "offset": offset,
                            "sortDirection": "asc",
                            "searchQuery": "",
                            "eventsPeriodFilter": "All",
                            "countryCode": "CA",
                            "state": "Alberta",
                            "selectedUniversityId": "189",
                            "currentUrl": page.url,
                            "device": "web_portal",
                            "version": 4,
                            "timestamp": int(time.time() * 1000),
                        }
                    ),
                    "endpoint": "getUnifiedSearch",
                }
            ),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        body = await payload.json()
        batch = body.get("results") or []
        total = body.get("totalItemCount", total)
        for row in batch:
            society_id = str(row.get("societyid") or "").strip()
            title = (row.get("title") or "").strip()
            if not society_id or not title:
                continue
            societies[society_id] = {
                "name": title,
                "url": f"https://campus.hellorubric.com/?s={society_id}",
                "category": None,
            }
        print(f"[ualberta]  ...{len(societies)} societies", flush=True)
        if len(batch) < 12:
            break
        offset += 12
        if total is not None and offset >= total:
            break
    return list(societies.values())


async def extract_discord_from_page(page: Page) -> str | None:
    """Return first Discord invite link found on the page, if any."""
    try:
        hrefs = await page.eval_on_selector_all(
            'a[href*="discord.gg"], a[href*="discord.com/invite"]',
            "els => els.map(e => e.href)",
        )
    except Exception:
        hrefs = []
    for href in hrefs:
        url = canon_discord(href)
        if url:
            return url
    try:
        text = await page.evaluate("() => document.body ? document.body.innerText : ''")
    except Exception:
        return None
    m = DISCORD_INVITE_RE.search(text or "")
    if not m:
        return None
    code = (m.group(1) or m.group(2) or "").strip()
    return canon_discord(f"https://discord.gg/{code}")


async def extract_socials_for_name(
    page: Page, club_name: str | None
) -> tuple[str | None, str | None]:
    """Prefer socials inside the smallest DOM container that mentions the club."""
    if club_name:
        terms = _candidate_search_terms(club_name)
        if terms:
            matched = await page.evaluate(
                r"""(terms) => {
                    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                    const nodes = [...document.querySelectorAll(
                        '.accordion-item, li.grid__item, .field__item, article, section, li, div'
                    )];
                    let best = null;
                    for (const node of nodes) {
                        const text = norm(node.innerText || node.textContent || '');
                        if (!text || text.length > 2500) continue;
                        if (!terms.every((term) => text.includes(term) || term.includes(text))) {
                            if (!terms.some((term) => text.includes(term))) continue;
                        }
                        const ig = [...node.querySelectorAll('a[href*="instagram.com"]')].map((a) => a.href);
                        const discord = [...node.querySelectorAll('a[href*="discord.gg"], a[href*="discord.com/invite"]')].map((a) => a.href);
                        if (!ig.length && !discord.length) continue;
                        const candidate = { ig, discord, len: text.length };
                        if (!best || candidate.len < best.len) best = candidate;
                    }
                    return best;
                }""",
                terms,
            )
            if matched:
                ig_url = None
                discord_url = None
                for href in matched.get("ig") or []:
                    ig_url = await page.evaluate(
                        "(href) => href",
                        href,
                    )
                    break
                for href in matched.get("discord") or []:
                    discord_url = await page.evaluate(
                        "(href) => href",
                        href,
                    )
                    break
                return (
                    canon_ig(ig_url)[0] if ig_url else None,
                    canon_discord(discord_url) if discord_url else None,
                )

    return await extract_ig_from_page(page), await extract_discord_from_page(page)


async def extract_ig_from_page(
    page: Page, skip_handles: frozenset[str] = frozenset()
) -> str | None:
    """Return first instagram.com link on the page, skipping directory-chrome handles."""
    try:
        hrefs = await page.eval_on_selector_all(
            'a[href*="instagram.com"]',
            "els => els.map(e => e.href)",
        )
    except Exception:
        return None
    for h in hrefs:
        url, handle = canon_ig(h)
        if url and (handle or "").lstrip("@").lower() not in skip_handles:
            return url
    return None


async def _harvest_ams_club_links(page: Page) -> list[dict]:
    rows = await page.evaluate(
        r"""() => {
            const out = [];
            const seen = new Set();
            for (const a of document.querySelectorAll('a[href*="amsclubs.ca/"]')) {
                let href = a.href.split('?')[0];
                if (!href.endsWith('/')) href += '/';
                const match = href.match(/amsclubs\.ca\/([^/]+)\//);
                if (!match) continue;
                const slug = match[1];
                if (seen.has(slug)) continue;
                seen.add(slug);
                const card = a.closest('.club-card, .card, article, li, div');
                const raw = (card?.querySelector('h3,h2,h4')?.innerText || a.innerText || '').trim();
                const name = raw.split('\n')[0].trim();
                if (!name) continue;
                out.push({ slug, name, url: href });
            }
            return out;
        }"""
    )
    clubs: list[dict] = []
    for row in rows:
        slug = row["slug"]
        if slug in AMS_SKIP_SLUGS:
            continue
        clubs.append(
            {
                "name": _clean_list_name(row.get("name"), slug),
                "url": row["url"],
                "category": None,
            }
        )
    return clubs


async def _discover_ams_clubs(ctx: BrowserContext) -> list[dict]:
    """Crawl amsclubs.ca/all-clubs pagenum pages and return every club detail URL."""
    page = await ctx.new_page()
    clubs_by_url: dict[str, dict] = {}
    try:
        page_no = 1
        while page_no <= 60:
            url = (
                "https://amsclubs.ca/all-clubs/"
                if page_no == 1
                else f"https://amsclubs.ca/all-clubs/pagenum/{page_no}/"
            )
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(2000)
            batch = await _harvest_ams_club_links(page)
            new = 0
            for club in batch:
                if club["url"] not in clubs_by_url:
                    clubs_by_url[club["url"]] = club
                    new += 1
            print(
                f"[ubc]  ...page {page_no}: batch={len(batch)} new={new} total={len(clubs_by_url)}",
                flush=True,
            )
            if new == 0:
                break
            page_no += 1
    finally:
        await page.close()
    return list(clubs_by_url.values())


async def scrape_ubc(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """Discover every AMS club from amsclubs.ca/all-clubs and read its detail page."""
    clubs = await _discover_ams_clubs(ctx)
    print(f"[ubc] discovered {len(clubs)} clubs from amsclubs.ca/all-clubs", flush=True)
    if with_details:
        return await _visit_details(ctx, clubs, school="UBC", campus="Vancouver", parallelism=8)
    return [
        {
            "School": "ubc",
            "Name": c["name"],
            "Category": c.get("category"),
            "Campus": "Vancouver",
            "Directory URL": c["url"],
            **_empty_social_row(),
        }
        for c in clubs
    ]


async def scrape_concordia(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """Refresh Concordia groups from the shared accordion directory page."""
    clubs = _load_seed_rows_from_xlsx("Concordia")
    print(f"[concordia] loaded {len(clubs)} clubs from master xlsx", flush=True)
    if with_details:
        return await _refresh_seeded_rows(ctx, clubs, school="Concordia", parallelism=1)
    return [
        {
            "School": "concordia",
            "Name": c["name"],
            "Category": c.get("category"),
            "Campus": c.get("campus"),
            "Directory URL": c["url"],
            **_empty_social_row(),
        }
        for c in clubs
    ]


async def scrape_memorial(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """Refresh Memorial groups from existing per-club and shared directory URLs."""
    clubs = _load_seed_rows_from_xlsx("mun")
    print(f"[mun] loaded {len(clubs)} clubs from master xlsx", flush=True)
    if with_details:
        return await _refresh_seeded_rows(ctx, clubs, school="mun", parallelism=6)
    return [
        {
            "School": "mun",
            "Name": c["name"],
            "Category": c.get("category"),
            "Campus": c.get("campus"),
            "Directory URL": c["url"],
            **_empty_social_row(),
        }
        for c in clubs
    ]


async def scrape_sfu(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """Refresh SFU club detail pages already present in the master sheet."""
    clubs = _load_seed_rows_from_xlsx("SFU")
    print(f"[sfu] loaded {len(clubs)} clubs from master xlsx", flush=True)
    if with_details:
        return await _refresh_seeded_rows(ctx, clubs, school="SFU", parallelism=8)
    return [
        {
            "School": "sfu",
            "Name": c["name"],
            "Category": c.get("category"),
            "Campus": c.get("campus"),
            "Directory URL": c["url"],
            **_empty_social_row(),
        }
        for c in clubs
    ]


async def _discover_umsu_clubs(ctx: BrowserContext) -> list[dict]:
    """Crawl umsu.ca/clubs pagination and return every club's own detail page."""
    page = await ctx.new_page()
    clubs: dict[str, dict] = {}
    try:
        for page_no in range(1, 30):
            url = (
                "https://umsu.ca/clubs/"
                if page_no == 1
                else f"https://umsu.ca/clubs/page/{page_no}/"
            )
            await page.goto(url, wait_until="networkidle", timeout=60000)
            cards = await page.evaluate(
                r"""() => {
                    const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,a')];
                    const out = [];
                    let heading = '';
                    for (const n of nodes) {
                        if (/^H[1-5]$/.test(n.tagName)) {
                            const t = (n.innerText || '').trim();
                            if (t) heading = t;
                        } else if (n.tagName === 'A' && /^learn more$/i.test((n.innerText || '').trim())) {
                            out.push({ name: heading, url: n.href.split('?')[0].replace(/\/$/, '') });
                        }
                    }
                    return out;
                }"""
            )
            if not cards:
                break
            for c in cards:
                clubs[c["url"]] = {
                    "name": _clean_list_name(c.get("name"), c["url"].rsplit("/", 1)[-1]),
                    "url": c["url"],
                    "category": None,
                }
            print(f"[umanitoba]  ...page {page_no}: {len(clubs)} clubs discovered", flush=True)
    finally:
        await page.close()
    return list(clubs.values())


async def scrape_umanitoba(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """Discover every UMSU club from umsu.ca/clubs and read its detail page."""
    clubs = await _discover_umsu_clubs(ctx)
    print(f"[umanitoba] discovered {len(clubs)} clubs from umsu.ca/clubs", flush=True)
    if with_details:
        return await _visit_details(
            ctx,
            clubs,
            school="UManitoba",
            campus="Winnipeg",
            parallelism=6,
            skip_ig_handles=UMSU_GLOBAL_IG,
        )
    return [
        {
            "School": "umanitoba",
            "Name": c["name"],
            "Category": c.get("category"),
            "Campus": c.get("campus"),
            "Directory URL": c["url"],
            **_empty_social_row(),
        }
        for c in clubs
    ]


async def scrape_ucalgary(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """suuofc.campuslabs.ca - browse the org directory and click LOAD MORE until exhausted."""
    page = await ctx.new_page()
    print("[ucalgary] loading engage/organizations ...", flush=True)
    await page.goto(
        "https://suuofc.campuslabs.ca/engage/organizations", wait_until="networkidle", timeout=90000
    )
    await page.wait_for_timeout(3000)

    clubs_by_url: dict[str, dict] = {}
    prev_count = 0
    stagnant_rounds = 0
    for round_i in range(50):
        for club in await _harvest_campuslabs_org_links(page):
            clubs_by_url[club["url"]] = club
        print(f"[ucalgary]  ...{len(clubs_by_url)} orgs visible", flush=True)
        if not await _click_load_more(page):
            break
        await page.wait_for_timeout(2000)
        if len(clubs_by_url) == prev_count:
            stagnant_rounds += 1
        else:
            stagnant_rounds = 0
        prev_count = len(clubs_by_url)
        if stagnant_rounds >= 2:
            break

    clubs = list(clubs_by_url.values())
    print(f"[ucalgary] fetched {len(clubs)} orgs total", flush=True)

    if with_details and clubs:
        results = await _visit_details(
            ctx, clubs, school="UCalgary", campus="Calgary", parallelism=6
        )
    else:
        results = [
            {
                "School": "ucalgary",
                "Name": c["name"],
                "Category": c.get("category"),
                "Campus": "Calgary",
                "Directory URL": c["url"],
                **_empty_social_row(),
            }
            for c in clubs
        ]

    await page.close()
    return results


async def scrape_ualberta(ctx: BrowserContext, with_details: bool) -> list[dict]:
    """campus.hellorubric.com - use the location/university pickers, then page results."""
    page = await ctx.new_page()
    print("[ualberta] loading rubric search ...", flush=True)
    await page.goto(
        "https://campus.hellorubric.com/search?type=societies",
        wait_until="networkidle",
        timeout=90000,
    )
    await page.wait_for_timeout(3000)
    await _select_ualberta_filters(page)
    clubs = await _fetch_ualberta_societies(ctx, page)
    print(f"[ualberta] fetched {len(clubs)} societies total", flush=True)

    if with_details and clubs:
        results = await _visit_details(
            ctx, clubs, school="UAlberta", campus="Edmonton", parallelism=5
        )
    else:
        results = [
            {
                "School": "ualberta",
                "Name": c["name"],
                "Category": None,
                "Campus": "Edmonton",
                "Directory URL": c["url"],
                **_empty_social_row(),
            }
            for c in clubs
        ]

    await page.close()
    return results


async def _visit_details(
    ctx: BrowserContext,
    clubs: list[dict],
    school: str,
    campus: str | None,
    parallelism: int,
    skip_ig_handles: frozenset[str] = frozenset(),
) -> list[dict]:
    """Visit each club's detail URL and pull Instagram + Discord links from the page."""
    sem = asyncio.Semaphore(parallelism)
    out: list[dict] = [None] * len(clubs)  # type: ignore[list-item]

    async def one(i: int, c: dict):
        async with sem:
            row = {
                "School": school,
                "Name": c["name"],
                "Category": c.get("category"),
                "Campus": campus,
                "Directory URL": c["url"],
                **_empty_social_row(),
            }
            page = await ctx.new_page()
            try:
                await page.goto(c["url"], wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(1500)
                ig_url = await extract_ig_from_page(page, skip_ig_handles)
                if ig_url:
                    url, handle = canon_ig(ig_url)
                    row["Instagram URL"] = url
                    row["Instagram Handle"] = handle
                    row["IG Source"] = "profile_page"
                discord_url = await extract_discord_from_page(page)
                if discord_url:
                    row["Discord URL"] = discord_url
                    row["Discord Source"] = "profile_page"
            except Exception as e:
                print(f"  [{school}] {c['name']}: {type(e).__name__}", flush=True)
            finally:
                await page.close()
            out[i] = row
            if (i + 1) % 25 == 0:
                ig_got = sum(1 for r in out if r and r.get("Instagram URL"))
                discord_got = sum(1 for r in out if r and r.get("Discord URL"))
                print(
                    f"  [{school}] {i + 1}/{len(clubs)} visited, IG: {ig_got}, Discord: {discord_got}",
                    flush=True,
                )

    await asyncio.gather(*(one(i, c) for i, c in enumerate(clubs)))
    return out


async def _refresh_seeded_rows(
    ctx: BrowserContext, clubs: list[dict], school: str, parallelism: int
) -> list[dict]:
    """Refresh socials for xlsx-seeded rows, reusing shared directory pages once."""
    groups: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for i, club in enumerate(clubs):
        groups[club["url"]].append((i, club))

    sem = asyncio.Semaphore(parallelism)
    out: list[dict] = [None] * len(clubs)  # type: ignore[list-item]

    async def one(url: str, entries: list[tuple[int, dict]]):
        async with sem:
            page = await ctx.new_page()
            try:
                await page.goto(url, wait_until="networkidle", timeout=45000)
                await page.wait_for_timeout(1500)
                for i, c in entries:
                    row = {
                        "School": school,
                        "Name": c["name"],
                        "Category": c.get("category"),
                        "Campus": c.get("campus"),
                        "Directory URL": c["url"],
                        **_empty_social_row(),
                    }
                    ig_url, discord_url = await extract_socials_for_name(page, c["name"])
                    if ig_url:
                        url_norm, handle = canon_ig(ig_url)
                        row["Instagram URL"] = url_norm
                        row["Instagram Handle"] = handle
                        row["IG Source"] = "profile_page"
                    if discord_url:
                        row["Discord URL"] = discord_url
                        row["Discord Source"] = "profile_page"
                    out[i] = row
            except Exception as e:
                print(f"  [{school}] {url}: {type(e).__name__}", flush=True)
                for i, c in entries:
                    out[i] = {
                        "School": school,
                        "Name": c["name"],
                        "Category": c.get("category"),
                        "Campus": c.get("campus"),
                        "Directory URL": c["url"],
                        **_empty_social_row(),
                    }
            finally:
                await page.close()

    await asyncio.gather(*(one(url, entries) for url, entries in groups.items()))
    return out


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--school",
        choices=["concordia", "mun", "sfu", "ubc", "ucalgary", "ualberta", "umanitoba", "all"],
        default="all",
    )
    parser.add_argument(
        "--with-details",
        action="store_true",
        help="Visit each club's detail page to extract Instagram and Discord (slower).",
    )
    parser.add_argument("--headed", action="store_true", help="Show the browser window.")
    args = parser.parse_args()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not args.headed)
        ctx = await browser.new_context(
            user_agent=USER_AGENT, viewport={"width": 1400, "height": 900}
        )

        handlers = {
            "concordia": scrape_concordia,
            "mun": scrape_memorial,
            "sfu": scrape_sfu,
            "ubc": scrape_ubc,
            "ucalgary": scrape_ucalgary,
            "ualberta": scrape_ualberta,
            "umanitoba": scrape_umanitoba,
        }
        schools = list(handlers.keys()) if args.school == "all" else [args.school]

        for s in schools:
            print(f"\n=== {s.upper()} ===", flush=True)
            try:
                results = await handlers[s](ctx, args.with_details)
                path = OUT_DIR / f"spa-{s}.json"
                path.write_text(json.dumps(results, indent=2))
                ig = sum(1 for r in results if r.get("Instagram URL"))
                discord = sum(1 for r in results if r.get("Discord URL"))
                print(
                    f"[{s}] wrote {len(results)} clubs -> {path} ({ig} with IG, {discord} with Discord)",
                    flush=True,
                )
            except Exception as e:
                print(f"[{s}] FAILED: {e}", flush=True)
                import traceback

                traceback.print_exc()

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
