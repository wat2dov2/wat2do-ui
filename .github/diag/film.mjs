// Films production pages frame by frame (Chrome's screencast), for diagnosing
// loading stutter without a browser on the Mac. Diagnostic only; not part of CI.
import { chromium, webkit } from "playwright";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const run = promisify(execFile);

const OUT = process.env.OUT ?? "film";
const BASE = process.env.BASE ?? "https://uwaterloo.wat2do.io";
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, cpu: 1 };
const PHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, cpu: 4, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

// Safari's engine. It has no CDP screencast, so it is filmed through Playwright's video.
const IPHONE = {
  browser: "webkit", viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

const CLUB = process.env.CLUB_PATH ?? "/clubs/11126";
const SCENARIOS = [
  { name: "webkit-iphone-cold", device: IPHONE, steps: [{ goto: `${CLUB}?film=${Date.now() + 2}` }, { wait: 5000 }] },
  { name: "webkit-iphone-cold-2", device: IPHONE, steps: [{ goto: `${CLUB}?film=${Date.now() + 3}` }, { wait: 5000 }] },
  { name: "webkit-iphone-reload", device: IPHONE, film: "after-first", steps: [{ goto: CLUB }, { wait: 5000 }, { goto: CLUB }, { wait: 5000 }] },
  { name: "club-phone-cold", device: PHONE, steps: [{ goto: `${CLUB}?film=${Date.now()}` }, { wait: 6000 }] },
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
  // Each frame: which poster <img> elements exist (a new element for a src seen before
  // means the card was rebuilt), whether they are decoded, and when the notch clip lands.
  store.imgs = []; store.clip = null; store.frames = 0;
  const watchFrame = () => {
    store.frames += 1;
    const t = Math.round(performance.now());
    for (const img of document.querySelectorAll("[data-slot=event-image-face] img, [data-slot=avatar-stack] img")) {
      if (!img.checkVisibility?.()) continue;
      if (!img.__film) {
        img.__film = true;
        store.imgs.push({ t, src: img.currentSrc.slice(-34) || img.src.slice(-34), complete: img.complete });
      }
    }
    if (store.clip === null && document.querySelector("[data-slot=event-image-face][style*=clip-path]")) store.clip = t;
    if (store.frames < 600) requestAnimationFrame(watchFrame);
  };
  requestAnimationFrame(watchFrame);
  const describe = (node) => {
    if (!(node instanceof Element)) return node ? node.nodeName : "null";
    const key = node.getAttribute("data-skeleton-key") ?? node.getAttribute("data-slot");
    const classes = typeof node.className === "string" ? node.className.split(/\s+/).slice(0, 5).join(".") : "";
    return `${node.tagName.toLowerCase()}${key ? `[${key}]` : ""}${classes ? `.${classes}` : ""}`;
  };
  const rect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  const watch = (type, onEntries) => {
    try { new PerformanceObserver((list) => onEntries(list.getEntries())).observe({ type, buffered: true }); } catch { /* not in this engine */ }
  };
  watch("layout-shift", (entries) => {
    for (const e of entries) {
      store.shifts.push({ t: Math.round(e.startTime), value: e.value, input: e.hadRecentInput,
        sources: e.sources.map((s) => ({ node: describe(s.node), prev: rect(s.previousRect), cur: rect(s.currentRect) })) });
    }
  });
  watch("longtask", (entries) => { for (const e of entries) store.longTasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); });
  watch("largest-contentful-paint", (entries) => { for (const e of entries) store.lcp.push({ t: Math.round(e.startTime), node: describe(e.element), size: e.size }); });
  watch("paint", (entries) => { for (const e of entries) store.paints.push({ name: e.name, t: Math.round(e.startTime) }); });
};

/** WebKit has no screencast: read the frames back out of Playwright's video of the page. */
async function videoFrames(videoPath, filmOffsetMs) {
  const dir = `${videoPath}.frames`;
  await mkdir(dir, { recursive: true });
  const fps = 50;
  await run("ffmpeg", ["-loglevel", "error", "-i", videoPath, "-vf", `fps=${fps}`, `${dir}/%05d.jpg`]);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".jpg")).sort();
  const frames = [];
  for (const [index, file] of files.entries()) {
    const t = Math.round((index * 1000) / fps - filmOffsetMs);
    if (t >= 0) frames.push({ t, data: await readFile(`${dir}/${file}`) });
  }
  return frames;
}

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

const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
await mkdir(OUT, { recursive: true });
const summary = [];
for (const scenario of SCENARIOS) {
  const { cpu = 1, browser: engine = "chromium", ...options } = scenario.device;
  const filmsVideo = engine === "webkit";
  const context = await browsers[engine].newContext(filmsVideo
    ? { ...options, recordVideo: { dir: `${OUT}/video-${scenario.name}`, size: options.viewport } }
    : options);
  const page = await context.newPage();
  const pageCreatedAt = Date.now();
  await page.addInitScript(OBSERVE);
  const cdp = filmsVideo ? null : await context.newCDPSession(page);
  if (cdp && cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  let frames = [];
  let filmStart = null;
  cdp?.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const at = metadata.timestamp * 1000;
    if (filmStart != null) frames.push({ t: Math.round(at - filmStart), data: Buffer.from(data, "base64") });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const startFilm = async () => {
    filmStart = Date.now();
    await cdp?.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
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
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 300)}`));
  try {
    for (const [index, step] of scenario.steps.entries()) {
      if (index === 0 && scenario.film !== "after-first") await startFilm();
      if (index === 2 && scenario.film === "after-first") {
        // Film the second load only.
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
  await cdp?.send("Page.stopScreencast").catch(() => {});
  const observed = await page.evaluate(() => window.__film).catch(() => null);
  await page.screenshot({ path: `${OUT}/${scenario.name}-final.png` }).catch(() => {});
  const video = page.video();
  await context.close();
  if (video) frames = await videoFrames(await video.path(), filmStart - pageCreatedAt).catch((error) => { marks.push({ error: String(error) }); return []; });
  const narrow = scenario.device === PHONE || scenario.device === IPHONE;
  const kept = await contactSheet(frames, `${OUT}/${scenario.name}.jpg`, narrow ? 8 : 4, narrow ? 195 : 480);
  const cls = (observed?.shifts ?? []).filter((s) => !s.input).reduce((sum, s) => sum + s.value, 0);
  const longTaskMs = (observed?.longTasks ?? []).reduce((sum, task) => sum + task.d, 0);
  summary.push({ name: scenario.name, frames: frames.length, kept, cls: Math.round(cls * 10000) / 10000, longTaskMs, marks, errors, documents, observed });
  console.log(`${scenario.name}: ${frames.length} frames (${kept} distinct), CLS ${cls.toFixed(4)}, long tasks ${longTaskMs} ms`);
}
await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await Promise.all(Object.values(browsers).map((browser) => browser.close()));
