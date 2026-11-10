import { test } from "next/experimental/testmode/playwright.js";
import { expect, type Page } from "@playwright/test";
import type { NextFixture } from "next/experimental/testmode/playwright.js";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { mockApi } from "./api-fixture";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

/*
 * Loading states must hold the exact layout of what replaces them.
 *
 * Fixtures follow what a campus usually shows: three-digit counts, event
 * titles that wrap to two lines on a card, club names with a handle, short
 * position titles, and clubs with a full screen of events. Loading states are
 * drawn for that usual case, so content far from it (a one-event club, a very
 * long description) can still differ below the first lines.
 *
 * Each surface is opened with its data held back, so the loading state paints
 * first; then the data is released. Every element marked `data-skeleton-key`
 * on both sides must keep its box (within 1px) across the swap, and the page
 * must record no layout shift while it loads, swaps and settles. The events
 * list paints its server-rendered first screen before the complete feed
 * arrives, so that first screen is held to the same standard. A club page waits
 * for its events and draws them with its header. The top bar is
 * also loaded with its HTML paused partway through, as a slow CPU or network
 * can leave it, and must not shift either. The back-to-top corner must keep its
 * place however the text around it measures.
 */

const BASE = process.env.SKELETON_LAYOUT_BASE_URL ?? "http://127.0.0.1:3000";
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const TOLERANCE_PX = 1;
const REPORT_ONLY = process.env.SKELETON_LAYOUT_REPORT === "1";

const SCHOOL = {
  slug: "uwaterloo", timezone: "America/Toronto", name: "University of Waterloo", primary_color: "#6b238e",
  secondary_color: "#ffd54f", email_domains: ["uwaterloo.ca"], language: "en", faculties: ["Engineering"],
  // A season on the calendar today, so its chip must already be in the server's and the loading filter row.
  event_seasons: [{
    id: "reading-week", classification_id: "reading_week", labels: { en: "Reading week" },
    display_windows: [{ start_date: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), end_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }],
  }],
};
// The backend's categories, which the app also ships as its first-paint fallback.
const CATEGORIES = [
  "Arts & Culture", "Academics & Science", "Business", "Community Service", "Environment",
  "Games & Recreation", "Health", "Media & Web", "Politics & Advocacy", "Religion & Spirituality",
];
const EVENT_CATEGORIES = CATEGORIES;
const CLUB_CATEGORIES = CATEGORIES;
const MEDIA = "https://media.skeleton.test";

const EVENT_TITLES = [
  "Fall Formal Ticket Sales and Info Night",
  "Intro to Machine Learning Workshop",
  "Diwali Night Cultural Showcase 2026",
  "Resume Review with Industry Mentors",
  "Board Game Social and Pizza Night",
  "Women in Engineering Networking Mixer",
  "Hack the North Info Session",
  "Midterm Study Session: Calculus 1",
  "Salsa Dance Lessons for Beginners",
  "Varsity Volleyball Home Opener",
  "Open Mic Night at the Bombshelter",
  "Startup Pitch Practice Evening",
  "Mental Health Awareness Week Kickoff",
  "Photography Walk Around Campus",
  "Chess Club Weekly Blitz Tournament",
  "Bubble Tea Social with the Korean Students Association",
];
const LOCATIONS = ["SLC Great Hall", "E7 4053", "MC Comfy Lounge", "DC 1350", "PAC Gym 2", "STC 0050"];
const CLUB_NAMES = [
  "Waterloo Engineering Society", "UW Computer Science Club", "Korean Students Association",
  "Dance Club", "Chess Club", "Photography Club", "UW Robotics Team", "Bubble Tea Appreciation Society",
  "Women in Computer Science", "Debate Society", "Outdoors Club", "Film Society",
  "Investment Club", "Formula Electric", "Climbing Club", "Anime Club",
];

/** A landmark's box; `label` names a filter control in reports and is not compared. */
type Box = { x: number; y: number; w: number; h: number; label?: string };
type Shift = { value: number; hadRecentInput: boolean; t: number; sources: { node: string; prev: Box; cur: Box }[] };

/** Next's own route handlers stay real; everything else under /api is the backend. */
const NEXT_ROUTES = ["/api/discovery", "/api/revalidate-events"];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/") || NEXT_ROUTES.some(route => url.pathname.startsWith(route))) return null;
  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

function startTime(index: number) {
  // Every early event shares one date section, so the first screen is one section like the loading grid.
  const base = Date.now() + 2 * 60 * 60 * 1000;
  return new Date(base + index * 60_000).toISOString();
}

function makeEvent(index: number) {
  const id = index + 1;
  const startsAt = startTime(index < 40 ? index : index * 90);
  const club = CLUB_NAMES[index % CLUB_NAMES.length]!;
  return {
    id,
    title: EVENT_TITLES[index % EVENT_TITLES.length]!,
    description: index === 0
      ? "Join us for an evening of food, music and friends.\nBring your student card."
      : null,
    location: LOCATIONS[index % LOCATIONS.length],
    map_location: null,
    occurrences: [{ id: id * 10, event_id: id, dtstart_utc: startsAt, dtend_utc: new Date(Date.parse(startsAt) + 2 * 3600_000).toISOString() }],
    price: index % 3 === 0 ? 0 : index % 3 === 1 ? null : 5,
    food: index % 4 === 0 ? ["Pizza"] : [],
    registration: false,
    source_image_url: `${MEDIA}/poster-${id % 4}.png`,
    club_logo_url: `${MEDIA}/logo.png`,
    category: EVENT_CATEGORIES[index % EVENT_CATEGORIES.length],
    club_id: (index % CLUB_NAMES.length) + 1,
    club,
    club_type: "wusa",
    club_page: "https://example.com/club",
    club_ig: "club",
    school: "uwaterloo",
    featured: false,
    is_directory_event: false,
    added_at: new Date(Date.now() - (index + 3) * 3600_000).toISOString(),
    campus_season_ids: [],
  };
}

const EVENTS = Array.from({ length: 120 }, (_, index) => makeEvent(index));

const CLUBS = Array.from({ length: 140 }, (_, index) => ({
  id: index + 1,
  club_name: CLUB_NAMES[index % CLUB_NAMES.length]!,
  status: "approved",
  categories: [CLUB_CATEGORIES[index % CLUB_CATEGORIES.length]!],
  club_page: "https://example.com/club",
  ig: `club_${index + 1}`,
  discord: index % 2 === 1 ? "https://discord.gg/club" : null,
  club_type: "wusa",
  logo_url: `${MEDIA}/logo.png`,
  school: "uwaterloo",
  event_count: 12 + index,
  // Most clubs have no open position.
  position_count: index % 10 === 0 ? 1 : 0,
  created_at: new Date(Date.now() - (index + 3) * 86_400_000).toISOString(),
}));

const POSITIONS = Array.from({ length: 110 }, (_, index) => ({
  id: index + 1,
  title: ["VP Events", "Marketing Lead", "Photographer", "Treasurer", "Designer"][index % 5]!,
  description: "Plan and run our weekly events, work with sponsors and lead a team of volunteers through the term.",
  position_type: (["executive", "committee", "volunteer", "staff", "internship"] as const)[index % 5],
  requirements: [],
  club_id: (index % CLUB_NAMES.length) + 1,
  club_name: CLUB_NAMES[index % CLUB_NAMES.length]!,
  club_logo_url: `${MEDIA}/logo.png`,
  source_url: "https://instagram.com/p/example",
  source_image_url: `${MEDIA}/poster-${index % 4}.png`,
  is_active: true,
  added_at: new Date(Date.now() - (index + 3) * 3600_000).toISOString(),
  updated_at: new Date(Date.now() - (index + 3) * 3600_000).toISOString(),
  school: "uwaterloo",
}));

function paginated<T>(items: T[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, page_size: 100, total_pages: 1, ...extra };
}

class Gate {
  private release!: () => void;
  readonly opened = new Promise<void>((resolve) => { this.release = resolve; });
  open() { this.release(); }
}

interface Gates {
  /** Held until the loading state has been measured. */
  data: Gate;
  /** Secondary client data (stats, attendees) that real visitors receive a beat later. */
  late: Gate;
}

let posterImages: Buffer[] | null = null;
async function images() {
  if (posterImages) return posterImages;
  const sizes: [number, number][] = [[1080, 1350], [1080, 1080], [1080, 1920], [1350, 1080]];
  posterImages = await Promise.all(sizes.map(([width, height], index) => sharp({
    create: { width, height, channels: 3, background: { r: 40 + index * 50, g: 90, b: 160 } },
  }).png().toBuffer()));
  return posterImages;
}

/** A signed-in visitor: the API restores their session and lists the club they run. */
interface Visitor {
  email: string;
  role: "user" | "admin";
  club: (typeof CLUBS)[number] | null;
}

/** Runs club 1, which hosts event 1. */
const EXECUTIVE: Visitor = { email: "exec@uwaterloo.ca", role: "user", club: CLUBS[0]! };
/** Runs club 2, so event 1 is someone else's. */
const OTHER_CLUBS_EXECUTIVE: Visitor = { email: "member@uwaterloo.ca", role: "user", club: CLUBS[1]! };
const ADMIN: Visitor = { email: "admin@wat2do.io", role: "admin", club: null };

interface MockOptions {
  /** Signed in as this visitor; signed out without one. */
  visitor?: Visitor;
  /** Fields that event 1 carries in this test only. */
  firstEvent?: Partial<(typeof EVENTS)[number]>;
}

async function installMocks(
  page: Page,
  next: NextFixture,
  gates: Gates,
  held: (path: string, url: URL) => boolean,
  { visitor, firstEvent }: MockOptions = {},
) {
  const posters = await images();
  await page.route(`${MEDIA}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname;
    const match = /poster-(\d)/.exec(name);
    await route.fulfill({ contentType: "image/png", body: match ? posters[Number(match[1])]! : posters[1]! });
  });
  await page.route(/googletagmanager\.com|google-analytics\.com/, route => route.abort());
  await page.route("https://www.google.com/maps/embed/**", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));

  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await mockApi(page, next, url => apiPath(url) !== null, async (request) => {
    const url = new URL(request.url);
    const path = apiPath(url)!;
    if (held(path, url)) await gates.data.opened;

    if (path === "/meta/constants") {
      return json({
        event_categories: EVENT_CATEGORIES, club_categories: CLUB_CATEGORIES, interests: [],
        interest_to_categories: {}, report_statuses: ["pending", "resolved", "dismissed"],
      });
    }
    if (path === "/schools") return json([SCHOOL]);
    if (path === "/schools/uwaterloo") return json(SCHOOL);
    if (path === "/site-banner") return json(null);
    if (path === "/discovery-queries" || path === "/interactions/batch" || path.endsWith("/view")) return { status: 204 };
    if (path === "/auth/refresh") {
      return visitor
        ? json({ access_token: "token", token_type: "bearer", expires_in: 900, user_id: "auth-1" })
        : json({ detail: "Not authenticated" }, 401);
    }
    if (path === "/users/me") {
      return visitor
        ? json({ id: "user-1", email: visitor.email, school: "uwaterloo", role: visitor.role, interests: [] })
        : json({ detail: "Not authenticated" }, 401);
    }
    if (path === "/clubs/mine") return json(visitor?.club ? [visitor.club] : []);
    // An event whose tickets are off, at a club that has not connected payouts.
    if (/^\/events\/\d+\/ticketing$/.test(path)) return json(null);
    if (/^\/clubs\/\d+\/payouts$/.test(path)) {
      return json({
        paid_tickets_enabled: false, connected: false, charges_enabled: false, payouts_enabled: false,
        details_submitted: false, requirements_due: [], country: "CA", currency: "cad",
      });
    }
    if (path === "/going-events" || path === "/saved-clubs") return json([]);
    if (path === "/events/stats") {
      await gates.late.opened;
      return json(Object.fromEntries(EVENTS.map(event => [String(event.id), { click_count: 10 + event.id, going_count: event.id % 3 }])));
    }
    if (path === "/positions/stats") {
      await gates.late.opened;
      return json(Object.fromEntries(POSITIONS.map(position => [String(position.id), { click_count: 5 + position.id }])));
    }
    if (/^\/going-events\/\d+\/attendees$/.test(path)) {
      await gates.late.opened;
      return json({ going_count: 0, attendees: [] });
    }
    if (path === "/events") {
      const clubId = url.searchParams.get("club_ids");
      const items = clubId ? EVENTS.slice(0, 30).map(event => ({ ...event, club_id: Number(clubId) })) : EVENTS;
      const latest = EVENTS[0]!;
      return json(paginated(items, { latest_added_event: { id: latest.id, title: latest.title, added_at: latest.added_at, club_name: latest.club, club_logo_url: latest.club_logo_url } }));
    }
    const eventMatch = /^\/events\/(\d+)$/.exec(path);
    if (eventMatch) {
      const event = EVENTS.find(item => item.id === Number(eventMatch[1]));
      if (!event) return json({ detail: "Not found" }, 404);
      return json(event.id === 1 ? { ...event, ...firstEvent } : event);
    }
    if (path === "/clubs") return json(paginated(CLUBS));
    const clubMatch = /^\/clubs\/(\d+)$/.exec(path);
    if (clubMatch) {
      const club = CLUBS.find(item => item.id === Number(clubMatch[1]));
      return club ? json(club) : json({ detail: "Not found" }, 404);
    }
    if (path === "/positions") {
      const clubId = url.searchParams.get("club_id");
      const items = clubId ? POSITIONS.filter(position => position.club_id === Number(clubId)) : POSITIONS;
      const latest = POSITIONS[0]!;
      return json(paginated(items, { latest_added_position: { id: latest.id, title: latest.title, added_at: latest.added_at, club_name: latest.club_name, club_logo_url: latest.club_logo_url } }));
    }
    console.log(`[skeleton-layout] unmocked ${request.method} ${path}${url.search}`);
    return json({ detail: "Not mocked" }, 404);
  });
}

/**
 * A returning visitor: their sign-in is cached in this browser, as it is after
 * any earlier visit, so the page can draw them signed in from its first frame.
 */
async function cacheSignIn(page: Page, visitor: Visitor) {
  const clubs = visitor.club ? [{ id: visitor.club.id, club_name: visitor.club.club_name, school: visitor.club.school }] : [];
  await page.addInitScript(([emailKey, profileKey, profile]) => {
    localStorage.setItem(emailKey, JSON.stringify(profile.email));
    localStorage.setItem(profileKey, JSON.stringify(profile.cached));
  }, [STORAGE_KEYS.USER_EMAIL, STORAGE_KEYS.USER_PROFILE, {
    email: visitor.email,
    cached: {
      id: "user-1", fullName: null, avatarUrl: null, faculty: "", interests: [], isFirstYear: false,
      school: "uwaterloo", role: visitor.role, hasClub: clubs.length > 0, clubs,
      clubId: clubs[0]?.id ?? null, clubName: clubs[0]?.club_name ?? null,
      payoutEmail: null, promoterTosAcceptedAt: null, promoterTosVersion: null,
    },
  }] as const);
}

const OBSERVE_SHIFTS = () => {
  const describe = (node: Node | null): string => {
    if (!(node instanceof Element)) return node ? node.nodeName : "null";
    const key = node.getAttribute("data-skeleton-key") ?? node.getAttribute("data-slot");
    const classes = typeof node.className === "string" ? node.className.split(/\s+/).slice(0, 4).join(".") : "";
    return `${node.tagName.toLowerCase()}${key ? `[${key}]` : ""}${classes ? `.${classes}` : ""}`;
  };
  const rect = (r: DOMRectReadOnly) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  const shifts: unknown[] = [];
  (window as unknown as { __shifts: unknown[] }).__shifts = shifts;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; startTime: number; sources: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
      shifts.push({
        value: entry.value, hadRecentInput: entry.hadRecentInput, t: entry.startTime,
        sources: entry.sources.map(source => ({ node: describe(source.node), prev: rect(source.previousRect), cur: rect(source.currentRect) })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
};

/** Boxes of every marked landmark that is rendered, keyed by name and occurrence. */
async function landmarks(page: Page, within?: string): Promise<Record<string, Box>> {
  return page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const result: Record<string, { x: number; y: number; w: number; h: number; label?: string }> = {};
    const seen = new Map<string, number>();
    // Filter controls are compared one by one: a chip that appears late pushes the rest along.
    const chips = "[data-skeleton-key=filter-bar] [role=group] > :not([aria-hidden=true]), [data-skeleton-key=filter-bar] [data-slot=select-trigger]";
    for (const element of root?.querySelectorAll<HTMLElement>(`[data-skeleton-key], ${chips}`) ?? []) {
      const key = element.dataset.skeletonKey ?? "filter-control";
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const r = element.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      result[`${key}#${index}`] = { x: r.x, y: r.y, w: r.width, h: r.height, label: element.dataset.skeletonKey ? undefined : element.textContent?.trim() };
    }
    return result;
  }, within ?? null);
}

/** Lets fonts, lazy chunks, images and entrance animations finish before measuring. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = () => document.getAnimations().filter(animation => {
      const timing = animation.effect?.getComputedTiming();
      return animation.playState === "running" && timing && Number.isFinite(timing.endTime as number);
    });
    for (let attempt = 0; attempt < 40 && finite().length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Lazy images below the fold never load; only the first screen's matter.
    const pending = [...document.images].filter(image => !image.complete && image.getBoundingClientRect().top < innerHeight);
    await Promise.race([
      Promise.all(pending.map(image => new Promise(resolve => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      }))),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(300);
}

/** A name or school runs as wide as its text, which no placeholder can know; everything else is exact. */
const TEXT_WIDTH_KEYS = new Set(["page-title", "page-description"]);

interface Comparison {
  compared: number;
  maxDelta: number;
  worst: string | null;
  mismatched: { key: string; loading: Box; loaded: Box; delta: number }[];
  loadingOnly: string[];
  loadedOnly: string[];
}

function compare(loading: Record<string, Box>, loaded: Record<string, Box>, viewportHeight: number): Comparison {
  const inView = (box: Box) => box.y < viewportHeight && box.y + box.h > 0;
  const result: Comparison = { compared: 0, maxDelta: 0, worst: null, mismatched: [], loadingOnly: [], loadedOnly: [] };
  for (const [key, before] of Object.entries(loading)) {
    if (!inView(before)) continue;
    const after = loaded[key];
    if (!after) { result.loadingOnly.push(key); continue; }
    result.compared += 1;
    const widthDelta = TEXT_WIDTH_KEYS.has(key.split("#")[0]!) ? 0 : Math.abs(before.w - after.w);
    const delta = Math.max(Math.abs(before.x - after.x), Math.abs(before.y - after.y), widthDelta, Math.abs(before.h - after.h));
    if (delta > result.maxDelta) { result.maxDelta = delta; result.worst = key; }
    if (delta > TOLERANCE_PX) result.mismatched.push({ key, loading: before, loaded: after, delta: Math.round(delta * 10) / 10 });
  }
  for (const [key, after] of Object.entries(loaded)) {
    if (inView(after) && !loading[key]) result.loadedOnly.push(key);
  }
  return result;
}

async function shiftsSince(page: Page, since = 0): Promise<{ cls: number; shifts: Shift[] }> {
  const shifts = (await page.evaluate(() => (window as unknown as { __shifts: unknown[] }).__shifts)) as Shift[];
  const counted = shifts.filter(shift => !shift.hadRecentInput && shift.t >= since);
  return { cls: counted.reduce((sum, shift) => sum + shift.value, 0), shifts: counted };
}

async function report(name: string, comparison: Comparison, cls: number, shifts: Shift[]) {
  const info = test.info();
  const summary = { surface: name, compared: comparison.compared, maxDelta: Math.round(comparison.maxDelta * 10) / 10, worst: comparison.worst, cls: Math.round(cls * 10000) / 10000,
    mismatched: comparison.mismatched, loadingOnly: comparison.loadingOnly, loadedOnly: comparison.loadedOnly, shifts };
  console.log(`[skeleton-layout] ${name}: max box delta ${summary.maxDelta}px (${summary.worst ?? "-"}), CLS ${summary.cls}, `
    + `${comparison.compared} compared, ${comparison.mismatched.length} moved, ${comparison.loadingOnly.length} loading-only, ${comparison.loadedOnly.length} loaded-only`);
  const body = JSON.stringify(summary, null, 2);
  await writeFile(info.outputPath(`${name}.json`), body);
  await info.attach(`${name}.json`, { body, contentType: "application/json" });
  if (REPORT_ONLY) return;
  expect(comparison.mismatched, `${name}: landmarks that moved across the swap`).toEqual([]);
  expect(comparison.loadingOnly, `${name}: loading landmarks with no loaded counterpart`).toEqual([]);
  expect(comparison.loadedOnly, `${name}: loaded landmarks with no loading counterpart`).toEqual([]);
  expect(cls, `${name}: cumulative layout shift`).toBe(0);
}

/** Measures the loading state, releases the data, and measures what replaced it. */
async function measureSwap(page: Page, gates: Gates, loaded: string, name: string, viewportHeight: number, since = 0) {
  await settle(page);
  const loadingBoxes = await landmarks(page);
  if (REPORT_ONLY) await page.screenshot({ path: test.info().outputPath(`${name}-loading.png`) });

  gates.data.open();
  await page.locator(loaded).first().waitFor();
  await settle(page);
  gates.late.open();
  await page.waitForLoadState("networkidle");
  await settle(page);
  const loadedBoxes = await landmarks(page);
  if (REPORT_ONLY) await page.screenshot({ path: test.info().outputPath(`${name}-loaded.png`) });

  return { ...(await shiftsSince(page, since)), comparison: compare(loadingBoxes, loadedBoxes, viewportHeight) };
}

/**
 * The events page's HTML carries only its first screen; the browser then asks
 * /api/discovery for the complete feed. This holds that request until `gate`
 * opens, so the first screen can be measured on its own. `requested` settles
 * once the hydrated page has asked.
 */
async function holdCompleteEventFeed(page: Page, gate: Gate) {
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  await page.route(url => url.pathname === "/api/discovery" && url.searchParams.get("resource") === "events", async (route) => {
    markRequested();
    await gate.opened;
    // Next's test proxy, routed on the context, still adds its headers.
    await route.fallback();
  });
  return { requested };
}

/**
 * Answers every browser request for the complete event feed with an error, as an
 * outage would, until `recover` is called; counts the requests.
 */
async function failCompleteEventFeed(page: Page) {
  let attempts = 0;
  let failing = true;
  await page.route(url => url.pathname === "/api/discovery" && url.searchParams.get("resource") === "events", async (route) => {
    if (!failing) return route.fallback();
    attempts += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Discovery is temporarily unavailable" }) });
  });
  return { attempts: () => attempts, recover: () => { failing = false; } };
}

/** `SKELETON_LAYOUT_CPU_THROTTLE=4` runs the page like a mid-range phone. */
async function throttleCpu(page: Page) {
  const rate = Number(process.env.SKELETON_LAYOUT_CPU_THROTTLE ?? 1);
  if (rate <= 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
}

/**
 * Serves the next visit to `path` with a slow, parser-blocking script right after
 * the top bar's primary navigation, so the browser may paint the page with the bar
 * half-parsed: the pause a slow CPU or network leaves there at random.
 */
async function pauseParsingInsideTopBar(page: Page, path: string, nextWorker: { proxyPort: number }) {
  const pause = `${BASE}/__parser-pause.js`;
  await page.route(pause, async (route) => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });
  await page.route(url => url.pathname === path, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    // Next's testmode adds these in its own route, which this one stands in for.
    const response = await route.fetch({ headers: {
      ...route.request().headers(),
      "next-test-proxy-port": String(nextWorker.proxyPort),
      "next-test-data": test.info().testId,
    } });
    const html = await response.text();
    const header = html.indexOf('data-slot="top-nav"');
    const navigationEnd = header < 0 ? -1 : html.indexOf("</nav>", header);
    if (navigationEnd < 0) throw new Error("The document has no top bar navigation to pause after");
    const at = navigationEnd + "</nav>".length;
    // The body goes back decoded, so the original encoding and length no longer apply.
    const headers = Object.fromEntries(Object.entries(response.headers())
      .filter(([name]) => !["content-encoding", "content-length", "transfer-encoding"].includes(name)));
    await route.fulfill({ status: response.status(), headers, body: `${html.slice(0, at)}<script src="${pause}"></script>${html.slice(at)}` });
  });
}

interface RouteSurface {
  name: string;
  path: string;
  /** Which API requests hold back the content (server and browser). */
  held: (path: string, url: URL) => boolean;
  /** Present once the loading state is on screen. */
  loading: string;
  /** Present once the real content has replaced it. */
  loaded: string;
}

const ROUTE_SURFACES: RouteSurface[] = [
  { name: "events-list", path: "/events", held: path => path === "/events", loading: "[data-slot=discovery-loading]", loaded: "[data-event-card]" },
  { name: "clubs-list", path: "/clubs", held: path => path === "/clubs", loading: "[data-slot=discovery-loading]", loaded: "[data-club-card]" },
  { name: "positions-list", path: "/positions", held: path => path === "/positions", loading: "[data-slot=discovery-loading]", loaded: "[data-slot=card-grid] article" },
  { name: "event-page", path: "/events/1", held: path => path === "/events/1", loading: "[data-slot=event-details-loading]", loaded: "[data-slot=event-host]" },
  { name: "club-page", path: "/clubs/1", held: path => path === "/clubs/1", loading: "[data-slot=club-details-loading]", loaded: "[data-slot=club-details]" },
];

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`skeleton layout (${viewportName})`, () => {
    test.use({ viewport });

    for (const surface of ROUTE_SURFACES) {
      test(`${surface.name} keeps its layout when content replaces the loading state`, async ({ page, next }) => {
        const gates: Gates = { data: new Gate(), late: new Gate() };
        await installMocks(page, next, gates, surface.held);
        await throttleCpu(page);
        await page.addInitScript(OBSERVE_SHIFTS);

        await page.goto(`${BASE}${surface.path}`, { waitUntil: "commit" });
        await page.locator(surface.loading).first().waitFor();
        const name = `${surface.name}-${viewportName}`;
        const { cls, shifts, comparison } = await measureSwap(page, gates, surface.loaded, name, viewport.height);
        await report(name, comparison, cls, shifts);
      });
    }

    test("club page waits for its events, then draws its header and events together", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      // The club itself is ready at once; only its events wait.
      await installMocks(page, next, gates, (path, url) => path === "/events" && url.searchParams.has("club_ids"));
      await throttleCpu(page);
      await page.addInitScript(OBSERVE_SHIFTS);

      await page.goto(`${BASE}/clubs/1`, { waitUntil: "commit" });
      await page.locator("[data-slot=club-details-loading]").first().waitFor();
      await settle(page);
      // Never the header over a screen of placeholder cards that then collapse to the club's real count.
      await expect(page.locator("[data-slot=club-details]")).toBeHidden();
      const name = `club-page-events-${viewportName}`;
      const { cls, shifts, comparison } = await measureSwap(page, gates, "[data-slot=club-details] [data-event-card]", name, viewport.height);
      await report(name, comparison, cls, shifts);
      // The first screen's logos load with the page instead of popping in after it.
      await expect(page.locator("img[src*='wat2do-logo-nav']").first()).toHaveAttribute("loading", "eager");
      await expect(page.locator("[data-slot=club-details] [data-slot=page-header] [data-slot=avatar-stack] img")).toHaveAttribute("loading", "eager");
      await expect(page.locator("[data-slot=club-details] [data-event-card] [data-slot=avatar-stack] img").first()).toHaveAttribute("loading", "eager");
      // A first-row poster that has arrived appears with the page, never as a placeholder first.
      await expect(page.locator("[data-slot=club-details] [data-event-card] [data-slot=event-image-face] img").first()).toHaveAttribute("decoding", "sync");
    });

    test("events list keeps its layout when the complete feed replaces the server's first screen", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      // The server reads the feed at once; only the browser's request for all of it waits.
      await installMocks(page, next, gates, () => false);
      const completeFeed = await holdCompleteEventFeed(page, gates.data);
      await throttleCpu(page);
      await page.addInitScript(OBSERVE_SHIFTS);

      await page.goto(`${BASE}/events`, { waitUntil: "commit" });
      await page.locator("[data-event-card]").first().waitFor();
      await completeFeed.requested;
      const name = `events-first-screen-${viewportName}`;
      const { cls, shifts, comparison } = await measureSwap(page, gates, "[data-event-card]", name, viewport.height);
      await report(name, comparison, cls, shifts);
    });

    test("a search made before the complete feed arrives waits for it, then searches every event", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      gates.late.open();
      await installMocks(page, next, gates, () => false);
      const completeFeed = await holdCompleteEventFeed(page, gates.data);
      await page.addInitScript(OBSERVE_SHIFTS);
      await page.goto(`${BASE}/events`);
      await completeFeed.requested;
      await page.locator("[data-event-card]").first().waitFor();
      await settle(page);
      const header = await landmarks(page, "[data-slot=page-header]");

      // Seven events are Varsity games, and only one of them is on the first screen.
      const search = page.locator("[data-search-input]");
      await search.fill("Varsity");
      await search.press("Enter");
      // The first screen cannot answer a search, so the results wait for the feed and say so.
      await expect(page.locator("[data-skeleton-key=count-heading]")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("main [aria-busy=true]").first()).toBeVisible();
      await expect(page.locator("[data-event-card]")).toHaveCount(0);
      await settle(page);
      const waiting = compare(header, await landmarks(page, "[data-slot=page-header]"), viewport.height);
      expect(waiting.mismatched, "the header holds still while the search waits").toEqual([]);
      expect([...waiting.loadingOnly, ...waiting.loadedOnly]).toEqual([]);
      expect((await shiftsSince(page)).cls, "waiting for the feed moves nothing").toBe(0);

      gates.data.open();
      await expect(page.locator("[data-event-card]")).toHaveCount(7);
      await expect(page.locator("[data-skeleton-key=count-heading]")).toHaveAttribute("aria-label", /^7 /);
    });

    test("events list keeps its first screen in place when the complete feed fails, and offers to try again", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      gates.late.open();
      await installMocks(page, next, gates, () => false);
      const completeFeed = await failCompleteEventFeed(page);
      await page.addInitScript(OBSERVE_SHIFTS);
      await page.goto(`${BASE}/events`);
      await page.locator("[data-event-card]").first().waitFor();
      // The row still waiting for the rest of the list is where the notice will appear.
      await page.locator("[data-testid=event-list-sentinel]").scrollIntoViewIfNeeded();
      await settle(page);
      const waiting = await landmarks(page);

      // The first read and each retry (about 1, 2 and 4 seconds apart) fail before the page says so.
      const notice = page.locator("[data-slot=load-failure-notice]");
      await expect(notice).toBeVisible({ timeout: 20_000 });
      expect(completeFeed.attempts()).toBe(4);
      await expect(page.locator("[data-slot=empty-state]")).toHaveCount(0);
      await expect(page.locator("[data-event-card]")).toHaveCount(16);
      await settle(page);
      const name = `events-feed-failed-${viewportName}`;
      const { cls, shifts } = await shiftsSince(page);
      await report(name, compare(waiting, await landmarks(page), viewport.height), cls, shifts);

      // The header still works: a search waits in its loading state, under the same notice.
      const search = page.locator("[data-search-input]");
      await search.fill("Varsity");
      await search.press("Enter");
      await expect(page.locator("[data-event-card]")).toHaveCount(0);
      await expect(page.locator("main [data-event-card-skeleton]").first()).toBeVisible();
      await expect(notice).toBeVisible();

      // Try again reads the feed again, and the search runs on all of it.
      completeFeed.recover();
      await notice.getByRole("button").click();
      await expect(page.locator("[data-event-card]")).toHaveCount(7);
      await expect(notice).toHaveCount(0);
      await expect(page.locator("[data-skeleton-key=count-heading]")).toHaveAttribute("aria-label", /^7 /);
    });

    test("an in-app navigation keeps its layout when the next page replaces its loading state", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      await installMocks(page, next, gates, path => path === "/clubs");
      await page.addInitScript(OBSERVE_SHIFTS);
      await page.goto(`${BASE}/positions`);
      await page.locator("[data-slot=card-grid] article").first().waitFor();
      await settle(page);

      // A script's click is not user input, so shifts after it still count.
      const navigatedAt = await page.evaluate(() => {
        document.querySelector<HTMLAnchorElement>("a[href='/clubs']")?.click();
        return performance.now();
      });
      await page.locator("[data-slot=discovery-loading]").waitFor();
      const name = `client-navigation-${viewportName}`;
      const { cls, shifts, comparison } = await measureSwap(page, gates, "[data-club-card]", name, viewport.height, navigatedAt);
      await report(name, comparison, cls, shifts);
    });

    test("event drawer keeps its layout when the event's details arrive", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      await installMocks(page, next, gates, (path) => path === "/events/1");
      await page.addInitScript(OBSERVE_SHIFTS);
      gates.late.open();
      // More events draws from the complete feed, which the page loads after its first screen.
      const completeFeed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/discovery");
      await page.goto(`${BASE}/events`);
      await page.locator("[data-event-card]").first().waitFor();
      await completeFeed;
      await settle(page);

      const openedAt = await page.evaluate(() => {
        // Cards open on mouse down with a mouse and on click with touch; send both, untrusted, like a script would.
        const card = document.querySelector<HTMLElement>("[data-event-card][data-event-id='1']");
        card?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        card?.click();
        return performance.now();
      });
      await page.locator("[data-slot=drawer-body]").waitFor();
      await settle(page);
      const loadingBoxes = await landmarks(page, "[role=dialog]");

      gates.data.open();
      await expect(page.locator("[role=dialog]")).toContainText("Bring your student card");
      await settle(page);
      const loadedBoxes = await landmarks(page, "[role=dialog]");

      const { cls, shifts } = await shiftsSince(page, openedAt);
      await report(`event-drawer-${viewportName}`, compare(loadingBoxes, loadedBoxes, viewport.height), cls, shifts);
    });

    test("club panel event page keeps its header from the server's HTML until its tickets load", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      gates.late.open();
      // Signed in as the club's executive. The event, its tickets and the club's payouts wait.
      // Its title is one line wide: a title's wrapping is the one thing no placeholder can know.
      await installMocks(
        page, next, gates,
        path => path === "/events/1" || path === "/events/1/ticketing" || path === "/clubs/1/payouts",
        { visitor: EXECUTIVE, firstEvent: { title: "Open Mic Night" } },
      );
      await cacheSignIn(page, EXECUTIVE);
      await throttleCpu(page);
      await page.addInitScript(OBSERVE_SHIFTS);

      await page.goto(`${BASE}/club-panel/events/1`, { waitUntil: "commit" });
      // The server's HTML already draws the page's header, before the session is restored.
      await page.locator("[data-slot=page-header-title] [data-slot=skeleton-line]").first().waitFor();
      const name = `club-panel-event-${viewportName}`;
      const { cls, shifts, comparison } = await measureSwap(page, gates, "[data-slot=ticket-settings-summary]", name, viewport.height);
      await report(name, comparison, cls, shifts);
    });

    for (const [who, visitor] of [["a returning visitor", OTHER_CLUBS_EXECUTIVE], ["an admin", ADMIN]] as const) {
      test(`event page draws ${who} signed in from its first frame`, async ({ page, next }) => {
        const gates: Gates = { data: new Gate(), late: new Gate() };
        await installMocks(page, next, gates, path => path === "/events/1", { visitor });
        await cacheSignIn(page, visitor);
        await throttleCpu(page);
        await page.addInitScript(OBSERVE_SHIFTS);

        await page.goto(`${BASE}/events/1`, { waitUntil: "commit" });
        await page.locator("[data-slot=event-details-loading]").first().waitFor();
        const name = `event-page-${visitor.role === "admin" ? "admin" : "signed-in"}-${viewportName}`;
        const { cls, shifts, comparison } = await measureSwap(page, gates, "[data-slot=event-host]", name, viewport.height);
        await report(name, comparison, cls, shifts);
        // The Going card is the visitor's own, not the signed-out email form.
        await expect(page.getByTestId("event-registration-auth")).toBeHidden();
      });
    }

    test("the top bar never paints half-parsed when the page's HTML pauses inside it", async ({ page, next, _nextWorker }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      gates.data.open();
      gates.late.open();
      await installMocks(page, next, gates, () => false);
      await pauseParsingInsideTopBar(page, "/clubs", _nextWorker);
      await page.addInitScript(OBSERVE_SHIFTS);
      await page.goto(`${BASE}/clubs`);
      await page.locator("[data-club-card]").first().waitFor();
      await settle(page);
      const { cls, shifts } = await shiftsSince(page);
      await report(`top-bar-parse-pause-${viewportName}`, compare({}, {}, viewport.height), cls, shifts);
    });

    test("the back-to-top corner keeps its place however the text around it measures", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      gates.data.open();
      gates.late.open();
      await installMocks(page, next, gates, () => false);
      await page.goto(`${BASE}/clubs`);
      await page.locator("[data-club-card]").first().waitFor();
      await settle(page);
      const corner = page.getByRole("button", { name: "Back to top", exact: true });
      const before = await corner.boundingBox();
      // The font swapping in, or the reader's text settings, change the line height
      // the page inherits. Exaggerate that change: the corner is pinned to the
      // bottom of the screen and must not move with it.
      await page.evaluate(() => { document.body.style.lineHeight = "3"; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await corner.boundingBox()).toEqual(before);
    });
  });
}
