import { test } from "next/experimental/testmode/playwright.js";
import { expect, type Page } from "@playwright/test";
import type { NextFixture } from "next/experimental/testmode/playwright.js";
import sharp from "sharp";
import { mockApi } from "./api-fixture";

/*
 * Loading states must hold the exact layout of what replaces them.
 *
 * Each surface is opened with its data held back, so the loading state paints
 * first; then the data is released. Every element marked `data-skeleton-key`
 * on both sides must keep its box (within 1px) across the swap, and the page
 * must record no layout shift while it loads, swaps and settles.
 */

const BASE = "http://127.0.0.1:3000";
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const TOLERANCE_PX = 1;
const REPORT_ONLY = process.env.SKELETON_LAYOUT_REPORT === "1";

const SCHOOL = {
  slug: "uwaterloo", timezone: "America/Toronto", name: "University of Waterloo", primary_color: "#6b238e",
  secondary_color: "#ffd54f", email_domains: ["uwaterloo.ca"], language: "en", faculties: ["Engineering"],
};
const EVENT_CATEGORIES = ["Academic", "Career", "Cultural", "Social", "Sports", "Technology", "Arts", "Wellness"];
const CLUB_CATEGORIES = ["Academic", "Cultural", "Social", "Sports", "Technology", "Arts"];
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

type Box = { x: number; y: number; w: number; h: number };
type Shift = { value: number; hadRecentInput: boolean; t: number; sources: { node: string; prev: Box; cur: Box }[] };

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) return null;
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
      ? "Join us for an evening of food, music and friends.\nTickets are $15 at the door, and every ticket includes dinner.\n\nBring your student card."
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

const CLUBS = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1,
  club_name: CLUB_NAMES[index % CLUB_NAMES.length]!,
  status: "approved",
  categories: [CLUB_CATEGORIES[index % CLUB_CATEGORIES.length]!],
  club_page: "https://example.com/club",
  ig: `club_${index + 1}`,
  discord: index % 2 === 0 ? "https://discord.gg/club" : null,
  club_type: "wusa",
  logo_url: `${MEDIA}/logo.png`,
  school: "uwaterloo",
  event_count: 12 + index,
  position_count: index % 3,
  created_at: new Date(Date.now() - (index + 3) * 86_400_000).toISOString(),
}));

const POSITIONS = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  title: ["VP Events", "Marketing Director", "Volunteer Photographer", "Treasurer", "Social Media Coordinator"][index % 5]!,
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

function page<T>(items: T[], extra: Record<string, unknown> = {}) {
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

async function installMocks(page: Page, next: NextFixture, gates: Gates, held: (path: string, url: URL) => boolean) {
  const posters = await images();
  await page.route(`${MEDIA}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname;
    const match = /poster-(\d)/.exec(name);
    await route.fulfill({ contentType: "image/png", body: match ? posters[Number(match[1])]! : posters[1]! });
  });
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
    if (path === "/auth/refresh" || path === "/users/me") return json({ detail: "Not authenticated" }, 401);
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
      const items = clubId ? EVENTS.filter(event => event.club_id === Number(clubId)) : EVENTS;
      const latest = EVENTS[0]!;
      return json(page(items, { latest_added_event: { id: latest.id, title: latest.title, added_at: latest.added_at, club_name: latest.club, club_logo_url: latest.club_logo_url } }));
    }
    const eventMatch = /^\/events\/(\d+)$/.exec(path);
    if (eventMatch) {
      const event = EVENTS.find(item => item.id === Number(eventMatch[1]));
      return event ? json(event) : json({ detail: "Not found" }, 404);
    }
    if (path === "/clubs") return json(page(CLUBS));
    const clubMatch = /^\/clubs\/(\d+)$/.exec(path);
    if (clubMatch) {
      const club = CLUBS.find(item => item.id === Number(clubMatch[1]));
      return club ? json(club) : json({ detail: "Not found" }, 404);
    }
    if (path === "/positions") {
      const clubId = url.searchParams.get("club_id");
      const items = clubId ? POSITIONS.filter(position => position.club_id === Number(clubId)) : POSITIONS;
      const latest = POSITIONS[0]!;
      return json(page(items, { latest_added_position: { id: latest.id, title: latest.title, added_at: latest.added_at, club_name: latest.club_name, club_logo_url: latest.club_logo_url } }));
    }
    console.log(`[skeleton-layout] unmocked ${request.method} ${path}${url.search}`);
    return json({ detail: "Not mocked" }, 404);
  });
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
    const result: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const seen = new Map<string, number>();
    for (const element of root?.querySelectorAll<HTMLElement>("[data-skeleton-key]") ?? []) {
      const key = element.dataset.skeletonKey!;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const r = element.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      result[`${key}#${index}`] = { x: r.x, y: r.y, w: r.width, h: r.height };
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
    await Promise.all([...document.images].filter(image => !image.complete).map(image => new Promise(resolve => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    })));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(300);
}

interface Comparison {
  maxDelta: number;
  worst: string | null;
  mismatched: { key: string; loading: Box; loaded: Box; delta: number }[];
  loadingOnly: string[];
  loadedOnly: string[];
}

function compare(loading: Record<string, Box>, loaded: Record<string, Box>, viewportHeight: number): Comparison {
  const inView = (box: Box) => box.y < viewportHeight && box.y + box.h > 0;
  const result: Comparison = { maxDelta: 0, worst: null, mismatched: [], loadingOnly: [], loadedOnly: [] };
  for (const [key, before] of Object.entries(loading)) {
    if (!inView(before)) continue;
    const after = loaded[key];
    if (!after) { result.loadingOnly.push(key); continue; }
    const delta = Math.max(Math.abs(before.x - after.x), Math.abs(before.y - after.y), Math.abs(before.w - after.w), Math.abs(before.h - after.h));
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
  const summary = { surface: name, maxDelta: Math.round(comparison.maxDelta * 10) / 10, worst: comparison.worst, cls: Math.round(cls * 10000) / 10000,
    mismatched: comparison.mismatched, loadingOnly: comparison.loadingOnly, loadedOnly: comparison.loadedOnly, shifts };
  console.log(`[skeleton-layout] ${name}: max box delta ${summary.maxDelta}px (${summary.worst ?? "-"}), CLS ${summary.cls}, `
    + `${comparison.mismatched.length} moved, ${comparison.loadingOnly.length} loading-only, ${comparison.loadedOnly.length} loaded-only`);
  await info.attach(`${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  if (REPORT_ONLY) return;
  expect(comparison.mismatched, `${name}: landmarks that moved across the swap`).toEqual([]);
  expect(comparison.loadingOnly, `${name}: loading landmarks with no loaded counterpart`).toEqual([]);
  expect(comparison.loadedOnly, `${name}: loaded landmarks with no loading counterpart`).toEqual([]);
  expect(cls, `${name}: cumulative layout shift`).toBe(0);
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
  { name: "club-page-events", path: "/clubs/1", held: (path, url) => path === "/events" && url.searchParams.has("club_ids"), loading: "[data-slot=club-details] [aria-busy=true]", loaded: "[data-slot=club-details] [data-event-card]" },
];

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`skeleton layout (${viewportName})`, () => {
    test.use({ viewport });

    for (const surface of ROUTE_SURFACES) {
      test(`${surface.name} keeps its layout when content replaces the loading state`, async ({ page, next }) => {
        const gates: Gates = { data: new Gate(), late: new Gate() };
        await installMocks(page, next, gates, surface.held);
        await page.addInitScript(OBSERVE_SHIFTS);

        await page.goto(`${BASE}${surface.path}`, { waitUntil: "commit" });
        await page.locator(surface.loading).first().waitFor();
        await settle(page);
        const loadingBoxes = await landmarks(page);

        gates.data.open();
        await page.locator(surface.loaded).first().waitFor();
        await settle(page);
        gates.late.open();
        await page.waitForLoadState("networkidle");
        await settle(page);
        const loadedBoxes = await landmarks(page);

        const { cls, shifts } = await shiftsSince(page);
        await report(`${surface.name}-${viewportName}`, compare(loadingBoxes, loadedBoxes, viewport.height), cls, shifts);
      });
    }

    test("event drawer keeps its layout when the event's details arrive", async ({ page, next }) => {
      const gates: Gates = { data: new Gate(), late: new Gate() };
      await installMocks(page, next, gates, (path) => path === "/events/1");
      await page.addInitScript(OBSERVE_SHIFTS);
      gates.late.open();
      await page.goto(`${BASE}/events`);
      await page.locator("[data-event-card]").first().waitFor();
      await settle(page);

      const openedAt = await page.evaluate(() => {
        document.querySelector<HTMLElement>("[data-event-card][data-event-id='1']")?.click();
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
  });
}
