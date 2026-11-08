// Films production pages frame by frame (Chrome's screencast), for diagnosing
// loading stutter without a browser on the Mac. Diagnostic only; not part of CI.
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = process.env.OUT ?? "film";
const BASE = process.env.BASE ?? "https://uwaterloo.wat2do.io";
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, cpu: 1 };
const PHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, cpu: 4, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

const CLUB = process.env.CLUB_PATH ?? "/clubs/11126";
const SCENARIOS = [
  { name: "club-desktop", device: DESKTOP, steps: [{ goto: CLUB }, { wait: 5000 }] },
  { name: "club-desktop-again", device: DESKTOP, steps: [{ goto: CLUB }, { wait: 5000 }] },
  { name: "club-phone", device: PHONE, steps: [{ goto: CLUB }, { wait: 6000 }] },
  { name: "club-phone-again", device: PHONE, steps: [{ goto: CLUB }, { wait: 6000 }] },
  // A returning visitor: the second load has the site's code in the browser cache.
  { name: "club-phone-reload", device: PHONE, film: "after-first", steps: [{ goto: CLUB }, { wait: 5000 }, { goto: CLUB }, { wait: 6000 }] },
  { name: "club-desktop-reload", device: DESKTOP, film: "after-first", steps: [{ goto: CLUB }, { wait: 5000 }, { goto: CLUB }, { wait: 5000 }] },
  // A query string the page ignores misses the CDN, so the server renders it fresh.
  { name: "club-phone-cold", device: PHONE, steps: [{ goto: `${CLUB}?film=${Date.now()}` }, { wait: 6000 }] },
  { name: "club-desktop-cold", device: DESKTOP, steps: [{ goto: `${CLUB}?film=${Date.now() + 1}` }, { wait: 5000 }] },
];

const OBSERVE = () => {
  const store = { shifts: [], longTasks: [], lcp: [], paints: [], reveals: [], firstFrame: null };
  window.__film = store;
  // React's streamed HTML reveals each finished boundary through $RV, in batches
  // at most one per 300 ms; log when each batch lands and what it holds.
  let reveal;
  Object.defineProperty(window, "$RV", {
    configurable: true,
    get: () => reveal,
    set: (fn) => {
      reveal = function (batch) {
        const ids = [];
        for (let i = 0; i < batch.length; i += 2) ids.push(`${batch[i]?.id ?? "?"}<-${batch[i + 1]?.id ?? "?"}`);
        store.reveals.push({ t: Math.round(performance.now()), ids });
        return fn.apply(this, arguments);
      };
    },
  });
  requestAnimationFrame(() => { store.firstFrame = Math.round(performance.now()); });
  const describe = (node) => {
    if (!(node instanceof Element)) return node ? node.nodeName : "null";
    const key = node.getAttribute("data-skeleton-key") ?? node.getAttribute("data-slot");
    const classes = typeof node.className === "string" ? node.className.split(/\s+/).slice(0, 5).join(".") : "";
    return `${node.tagName.toLowerCase()}${key ? `[${key}]` : ""}${classes ? `.${classes}` : ""}`;
  };
  const rect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      store.shifts.push({ t: Math.round(e.startTime), value: e.value, input: e.hadRecentInput,
        sources: e.sources.map((s) => ({ node: describe(s.node), prev: rect(s.previousRect), cur: rect(s.currentRect) })) });
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) store.longTasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) store.lcp.push({ t: Math.round(e.startTime), node: describe(e.element), size: e.size });
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) store.paints.push({ name: e.name, t: Math.round(e.startTime) });
  }).observe({ type: "paint", buffered: true });
};

async function contactSheet(frames, file, columns, tileWidth) {
  if (frames.length === 0) return 0;
  // Keep a frame only when it differs visibly from the last one kept.
  const kept = [];
  let previous = null;
  for (const frame of frames) {
    const probe = await sharp(frame.data).resize(48, 30, { fit: "fill" }).greyscale().raw().toBuffer();
    let diff = Infinity;
    if (previous) {
      let sum = 0;
      for (let i = 0; i < probe.length; i += 1) sum += Math.abs(probe[i] - previous[i]);
      diff = sum / probe.length;
    }
    if (diff > 0.6) { kept.push(frame); previous = probe; }
  }
  const tiles = kept.slice(0, 48);
  const meta = await sharp(tiles[0].data).metadata();
  const tileHeight = Math.round((meta.height / meta.width) * tileWidth);
  const label = 18;
  const rows = Math.ceil(tiles.length / columns);
  const composites = [];
  for (const [index, frame] of tiles.entries()) {
    const left = (index % columns) * (tileWidth + 6);
    const top = Math.floor(index / columns) * (tileHeight + label + 6);
    composites.push({ input: await sharp(frame.data).resize(tileWidth, tileHeight, { fit: "fill" }).toBuffer(), left, top: top + label });
    const text = `<svg width="${tileWidth}" height="${label}"><rect width="100%" height="100%" fill="#222"/><text x="4" y="13" font-size="12" font-family="monospace" fill="#fff">${index}: +${frame.t} ms</text></svg>`;
    composites.push({ input: Buffer.from(text), left, top });
  }
  await sharp({ create: { width: columns * (tileWidth + 6), height: rows * (tileHeight + label + 6), channels: 3, background: "#888" } })
    .composite(composites).jpeg({ quality: 80 }).toFile(file);
  return tiles.length;
}

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const summary = [];
for (const scenario of SCENARIOS) {
  const { cpu, ...options } = scenario.device;
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.addInitScript(OBSERVE);
  const cdp = await context.newCDPSession(page);
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const frames = [];
  let filmStart = null;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const at = metadata.timestamp * 1000;
    if (filmStart != null) frames.push({ t: Math.round(at - filmStart), data: Buffer.from(data, "base64") });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const startFilm = async () => {
    filmStart = Date.now();
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  };
  const documents = [];
  page.on("response", (response) => {
    const request = response.request();
    if (request.resourceType() === "document" || /\/api\//.test(request.url())) {
      const timing = request.timing();
      documents.push({ url: request.url().replace(BASE, ""), status: response.status(), cache: response.headers()["x-vercel-cache"] ?? null,
        age: response.headers()["age"] ?? null, ttfb: Math.round(timing.responseStart), end: Math.round(timing.responseEnd) });
    }
  });
  const marks = [];
  try {
    for (const [index, step] of scenario.steps.entries()) {
      if (index === 0 && scenario.film !== "after-first") await startFilm();
      if (index === 1 && scenario.film === "after-first") {
        // Film the in-app navigation only.
        await page.evaluate(() => { window.__film.shifts.length = 0; window.__film.longTasks.length = 0; });
        await startFilm();
      }
      if (step.goto) { marks.push({ step: `goto ${step.goto}`, t: filmStart ? Date.now() - filmStart : 0 }); await page.goto(`${BASE}${step.goto}`, { waitUntil: "commit" }); }
      if (step.click) {
        marks.push({ step: `click ${step.click}`, t: Date.now() - filmStart });
        await page.locator(step.click).first().click({ timeout: 10000 });
      }
      if (step.wait) await page.waitForTimeout(step.wait);
    }
  } catch (error) {
    marks.push({ error: String(error) });
  }
  await cdp.send("Page.stopScreencast").catch(() => {});
  const observed = await page.evaluate(() => window.__film).catch(() => null);
  const columns = scenario.device === PHONE ? 8 : 4;
  const tileWidth = scenario.device === PHONE ? 195 : 480;
  const kept = await contactSheet(frames, `${OUT}/${scenario.name}.jpg`, columns, tileWidth);
  await page.screenshot({ path: `${OUT}/${scenario.name}-final.png` }).catch(() => {});
  const cls = (observed?.shifts ?? []).filter((s) => !s.input).reduce((sum, s) => sum + s.value, 0);
  const longTaskMs = (observed?.longTasks ?? []).reduce((sum, task) => sum + task.d, 0);
  summary.push({ name: scenario.name, frames: frames.length, kept, cls: Math.round(cls * 10000) / 10000, longTaskMs, marks, documents, observed });
  console.log(`${scenario.name}: ${frames.length} frames (${kept} distinct), CLS ${cls.toFixed(4)}, long tasks ${longTaskMs} ms`);
  await context.close();
}
await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await browser.close();
