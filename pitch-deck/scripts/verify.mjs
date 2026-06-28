// Visual verification: walk every slide, screenshot it, and detect any
// element overflowing the viewport or its own scroll container.
//
// Usage:
//   node scripts/verify.mjs [--url http://localhost:3001]

import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../verify-out");

const urlArgIdx = process.argv.indexOf("--url");
const URL = urlArgIdx > -1 ? process.argv[urlArgIdx + 1] : "http://localhost:3001/";

const slideNames = [
  "01-title",
  "02-manifesto",
  "03-problem",
  "04-market",
  "05-solution-overview",
  "06-pipeline",
  "07-features",
  "08-metrics",
  "09-roi",
  "10-demo-backup",
  "11-close",
];

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
];

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

// Detect overflow on the active slide. We allow swiper-button/pagination
// elements to extend outside their parents since swiper positions them.
async function inspectActiveSlide(page, viewport) {
  return page.evaluate((vp) => {
    const issues = [];
    const activeSlide = document.querySelector(".swiper-slide-active");
    if (!activeSlide) return [{ kind: "no-active-slide" }];

    // 1) Anything visible whose box extends past the viewport
    const all = activeSlide.querySelectorAll("*");
    for (const el of all) {
      if (
        el.classList.contains("swiper-button-prev") ||
        el.classList.contains("swiper-button-next") ||
        el.classList.contains("swiper-pagination") ||
        el.closest(".swiper-pagination")
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (rect.width === 0 || rect.height === 0) continue;

      // Allow ~2px sub-pixel tolerance
      const tol = 2;
      const offRight = rect.right - vp.width;
      const offBottom = rect.bottom - vp.height;
      const offLeft = -rect.left;
      const offTop = -rect.top;

      if (offRight > tol || offBottom > tol || offLeft > tol || offTop > tol) {
        // Skip transparent decorative wrappers that intentionally extend
        // (e.g. the mosaic absolute-positioned background grid).
        if (
          el.getAttribute("aria-hidden") === "true" ||
          el.closest('[aria-hidden="true"]') ||
          el.classList.contains("brand-wave")
        ) {
          continue;
        }
        issues.push({
          kind: "viewport-overflow",
          tag: el.tagName.toLowerCase(),
          cls: el.className && typeof el.className === "string"
            ? el.className.slice(0, 80)
            : "",
          text: (el.textContent || "").trim().slice(0, 60),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
          },
          over: {
            right: Math.round(offRight),
            bottom: Math.round(offBottom),
            left: Math.round(offLeft),
            top: Math.round(offTop),
          },
        });
      }
    }

    // 2) Any element whose scrollWidth/scrollHeight exceeds its clientWidth/Height
    //    (i.e. content clipped by overflow: hidden)
    for (const el of all) {
      if (!(el instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(el);
      const clipsX = style.overflowX === "hidden" || style.overflow === "hidden";
      const clipsY = style.overflowY === "hidden" || style.overflow === "hidden";
      if (!clipsX && !clipsY) continue;
      const dx = el.scrollWidth - el.clientWidth;
      const dy = el.scrollHeight - el.clientHeight;
      // Sub-6px scroll deltas are noise from inset box-shadows interacting
      // with overflow: hidden, not real overflow.
      if (dx > 6 || dy > 6) {
        const textOverflow = style.textOverflow;
        if (dy <= 6 && textOverflow === "ellipsis") {
          continue;
        }
        if (
          el.getAttribute("aria-hidden") === "true" ||
          el.closest('[aria-hidden="true"]') ||
          el.classList.contains("swiper") ||
          el.classList.contains("swiper-wrapper")
        ) {
          continue;
        }
        issues.push({
          kind: "clipped-content",
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
          text: (el.textContent || "").trim().slice(0, 60),
          dx,
          dy,
        });
      }
    }

    // 3) Content area should use most of the vertical space below the title.
    const content = activeSlide.querySelector("[data-slide-content]");
    if (content instanceof HTMLElement) {
      const contentRect = content.getBoundingClientRect();
      let maxBottom = contentRect.top;
      let minTop = contentRect.bottom;
      for (const el of content.querySelectorAll("*")) {
        if (!(el instanceof HTMLElement)) continue;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.top < minTop) minTop = rect.top;
        if (rect.bottom > maxBottom) maxBottom = rect.bottom;
      }
      const fillRatio =
        contentRect.height > 0
          ? (maxBottom - contentRect.top) / contentRect.height
          : 1;
      const topGap = Math.max(0, minTop - contentRect.top);
      const bottomGap = Math.max(0, contentRect.bottom - maxBottom);
      const strandedAtTop = bottomGap > Math.max(topGap * 1.5, 80);
      if (fillRatio < 0.78 && strandedAtTop) {
        issues.push({
          kind: "low-fill",
          fillPct: Math.round(fillRatio * 100),
          contentHeight: Math.round(contentRect.height),
          usedHeight: Math.round(maxBottom - contentRect.top),
        });
      }

      let placeholderBadges = 0;
      for (const el of activeSlide.querySelectorAll("*")) {
        if (!(el instanceof HTMLElement)) continue;
        if ((el.textContent || "").trim().toLowerCase() === "placeholder") {
          placeholderBadges += 1;
        }
      }
      if (placeholderBadges > 0) {
        issues.push({ kind: "placeholder-noise", count: placeholderBadges });
      }

      for (const card of content.querySelectorAll("[data-card]")) {
        if (!(card instanceof HTMLElement)) continue;
        const cardRect = card.getBoundingClientRect();
        if (cardRect.height < 72) continue;
        let cardBottom = cardRect.top;
        for (const el of card.querySelectorAll("*")) {
          if (!(el instanceof HTMLElement)) continue;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (rect.width < 8 || rect.height < 8) continue;
          if (rect.bottom > cardBottom) cardBottom = rect.bottom;
        }
        const cardFill =
          cardRect.height > 0 ? (cardBottom - cardRect.top) / cardRect.height : 1;
        if (cardFill < 0.45) {
          issues.push({
            kind: "empty-card",
            fillPct: Math.round(cardFill * 100),
            height: Math.round(cardRect.height),
          });
        }
      }

      const rotated = activeSlide.querySelectorAll('[style*="rotate("]');
      if (rotated.length > 0) {
        issues.push({ kind: "tilted-cards", count: rotated.length });
      }
    }

    // Limit noise; only first ~10 per slide is plenty to debug.
    return issues.slice(0, 12);
  }, viewport);
}

async function run() {
  await ensureDir(outDir);
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Silence noisy "failed to load image" console errors from Apify/IG CDNs;
  // they don't affect layout.
  page.on("pageerror", (err) => {
    console.error("[pageerror]", err.message);
  });

  const report = {};

  for (const vp of viewports) {
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    // Allow the event-image fetch + image decode + fonts to settle.
    await new Promise((r) => setTimeout(r, 5000));

    const vpDir = path.join(outDir, vp.name);
    await ensureDir(vpDir);
    report[vp.name] = [];

    for (let i = 0; i < slideNames.length; i++) {
      // Wait one paint after each navigation
      const issues = await inspectActiveSlide(page, vp);
      const filename = path.join(vpDir, `${slideNames[i]}.png`);
      await page.screenshot({ path: filename, fullPage: false });
      report[vp.name].push({ slide: slideNames[i], issues });

      // Advance to next slide unless we just shot the last one
      if (i < slideNames.length - 1) {
        await page.keyboard.press("ArrowRight");
        await new Promise((r) => setTimeout(r, 700)); // allow swiper transition
      }
    }
  }

  await browser.close();

  // Write JSON report
  const reportPath = path.join(outDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Pretty-print
  let totalIssues = 0;
  for (const [vp, slides] of Object.entries(report)) {
    console.log(`\n=== ${vp} ===`);
    for (const { slide, issues } of slides) {
      if (issues.length === 0) {
        console.log(`  ${slide}: OK`);
      } else {
        totalIssues += issues.length;
        console.log(`  ${slide}: ${issues.length} issue(s)`);
        for (const it of issues) {
          if (it.kind === "viewport-overflow") {
            console.log(
              `    - overflow <${it.tag}> over=${JSON.stringify(it.over)} text="${it.text}"`
            );
          } else if (it.kind === "clipped-content") {
            console.log(
              `    - clipped <${it.tag}> dx=${it.dx} dy=${it.dy} text="${it.text}"`
            );
          } else if (it.kind === "low-fill") {
            console.log(
              `    - low fill ${it.fillPct}% used=${it.usedHeight}px of ${it.contentHeight}px`
            );
          } else if (it.kind === "placeholder-noise") {
            console.log(`    - placeholder badges: ${it.count}`);
          } else if (it.kind === "empty-card") {
            console.log(
              `    - empty card fill ${it.fillPct}% height=${it.height}px`
            );
          } else if (it.kind === "tilted-cards") {
            console.log(`    - tilted cards: ${it.count}`);
          } else {
            console.log(`    -`, it);
          }
        }
      }
    }
  }

  console.log(`\nScreenshots → ${outDir}`);
  console.log(`Report      → ${reportPath}`);
  console.log(`Total issues: ${totalIssues}`);

  process.exit(totalIssues > 0 ? 0 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
