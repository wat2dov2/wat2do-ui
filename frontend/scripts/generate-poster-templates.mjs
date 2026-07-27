import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { createElement } from "react";
import satori from "satori";

const PAGE_WIDTH = 2550;
const PAGE_HEIGHT = 3300;
const EXPECTED_TEMPLATE_IDS = [
  "campus-colour",
  "campus-black-white",
  "campus-low-ink",
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(frontendRoot, "..");
const controlboxPath = path.join(
  repositoryRoot,
  "backend",
  "controlbox",
  "promoter_program.json",
);

const INK = "#111111";
const BLUE = "#0056D6";
const ORANGE = "#F97316";
const YELLOW = "#FFC629";
const PAPER = "#F7F4EC";
const WHITE = "#FFFFFF";

const FONT_FILES = [
  { file: "inter-latin-400-normal.woff", weight: 400 },
  { file: "inter-latin-500-normal.woff", weight: 500 },
  { file: "inter-latin-600-normal.woff", weight: 600 },
  { file: "inter-latin-700-normal.woff", weight: 700 },
];

function flattenChildren(children) {
  return children
    .flat(8)
    .filter((child) => child !== null && child !== undefined && child !== false);
}

function box(style, ...children) {
  return createElement(
    "div",
    { style: { display: "flex", ...style } },
    ...flattenChildren(children),
  );
}

function keyedBox(key, style, ...children) {
  return createElement(
    "div",
    { key, style: { display: "flex", ...style } },
    ...flattenChildren(children),
  );
}

function posterFrame(backgroundColor, color, ...children) {
  return box(
    {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      position: "relative",
      overflow: "hidden",
      backgroundColor,
      color,
      fontFamily: "Inter",
    },
    children,
  );
}

function wordmark({ left = 150, top = 120, color = INK, backgroundColor = null }) {
  return box(
    {
      position: "absolute",
      left,
      top,
      height: 94,
      alignItems: "center",
      padding: backgroundColor ? "0 28px" : 0,
      backgroundColor: backgroundColor ?? "transparent",
      color,
      fontSize: 58,
      fontWeight: 700,
      letterSpacing: -3,
    },
    "WAT2DO?",
  );
}

function microLabel({
  text,
  left,
  top,
  color = INK,
  fontSize = 29,
  letterSpacing = 5,
  width,
  align = "left",
}) {
  return box(
    {
      position: "absolute",
      left,
      top,
      width,
      color,
      fontSize,
      fontWeight: 600,
      letterSpacing,
      textTransform: "uppercase",
      justifyContent:
        align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
    },
    text,
  );
}

function horizontalRule({ left, top, width, height = 4, color = INK }) {
  return box({
    position: "absolute",
    left,
    top,
    width,
    height,
    backgroundColor: color,
  });
}

function verticalRule({ left, top, height, width = 4, color = INK }) {
  return box({
    position: "absolute",
    left,
    top,
    width,
    height,
    backgroundColor: color,
  });
}

function outlinedCircle({ left, top, size, color = INK, stroke = 5 }) {
  return box({
    position: "absolute",
    left,
    top,
    width: size,
    height: size,
    borderRadius: 9999,
    border: `${stroke}px solid ${color}`,
  });
}

function dotMatrix({
  left,
  top,
  columns,
  rows,
  gap,
  size,
  color = INK,
}) {
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return keyedBox(`dot-${left}-${top}-${index}`, {
      position: "absolute",
      left: left + column * gap,
      top: top + row * gap,
      width: size,
      height: size,
      borderRadius: 9999,
      backgroundColor: color,
    });
  });
}

function qrSlot(qr, { frameColor = INK, accentColor = null, lowInk = false } = {}) {
  const frameGap = 32;
  const frameThickness = lowInk ? 4 : 10;
  const frameLeft = qr.left - frameGap;
  const frameTop = qr.top - frameGap;
  const frameWidth = qr.size + frameGap * 2;
  const frameHeight = qr.size + frameGap * 2;

  return [
    box({
      position: "absolute",
      left: qr.left,
      top: qr.top,
      width: qr.size,
      height: qr.size,
      backgroundColor: WHITE,
    }),
    horizontalRule({
      left: frameLeft,
      top: frameTop,
      width: frameWidth,
      height: frameThickness,
      color: frameColor,
    }),
    horizontalRule({
      left: frameLeft,
      top: frameTop + frameHeight - frameThickness,
      width: frameWidth,
      height: frameThickness,
      color: frameColor,
    }),
    verticalRule({
      left: frameLeft,
      top: frameTop,
      height: frameHeight,
      width: frameThickness,
      color: frameColor,
    }),
    verticalRule({
      left: frameLeft + frameWidth - frameThickness,
      top: frameTop,
      height: frameHeight,
      width: frameThickness,
      color: frameColor,
    }),
    accentColor
      ? box({
          position: "absolute",
          left: frameLeft - 22,
          top: frameTop - 22,
          width: 118,
          height: 22,
          backgroundColor: accentColor,
        })
      : null,
    accentColor
      ? box({
          position: "absolute",
          left: frameLeft - 22,
          top: frameTop - 22,
          width: 22,
          height: 118,
          backgroundColor: accentColor,
        })
      : null,
    accentColor
      ? box({
          position: "absolute",
          left: frameLeft + frameWidth - 96,
          top: frameTop + frameHeight,
          width: 118,
          height: 22,
          backgroundColor: accentColor,
        })
      : null,
    accentColor
      ? box({
          position: "absolute",
          left: frameLeft + frameWidth,
          top: frameTop + frameHeight - 96,
          width: 22,
          height: 118,
          backgroundColor: accentColor,
        })
      : null,
  ];
}

function commonSupportLine({ left, top, color = INK, width = 1500 }) {
  return box(
    {
      position: "absolute",
      left,
      top,
      width,
      color,
      fontSize: 42,
      fontWeight: 600,
      letterSpacing: 2,
      lineHeight: 1.25,
      textTransform: "uppercase",
    },
    "Events, clubs, people. All in one place.",
  );
}

function colourPoster(qr) {
  const indexLabels = ["EVENTS", "CLUBS", "PEOPLE", "PLACES"];

  return posterFrame(
    BLUE,
    WHITE,
    box({
      position: "absolute",
      left: 0,
      top: 1580,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT - 1580,
      backgroundColor: PAPER,
    }),
    box({
      position: "absolute",
      right: 0,
      top: 0,
      width: 250,
      height: 1580,
      backgroundColor: ORANGE,
    }),
    box({
      position: "absolute",
      right: 250,
      top: 0,
      width: 70,
      height: 1580,
      backgroundColor: YELLOW,
    }),
    outlinedCircle({
      left: 1850,
      top: 190,
      size: 430,
      color: YELLOW,
      stroke: 30,
    }),
    outlinedCircle({
      left: 1965,
      top: 305,
      size: 200,
      color: ORANGE,
      stroke: 22,
    }),
    wordmark({
      left: 150,
      top: 110,
      color: YELLOW,
      backgroundColor: INK,
    }),
    microLabel({
      text: "THE CAMPUS INDEX / 01",
      left: 1550,
      top: 140,
      color: WHITE,
      width: 650,
      align: "right",
    }),
    box(
      {
        position: "absolute",
        left: 145,
        top: 350,
        flexDirection: "column",
        width: 2050,
        color: WHITE,
        fontSize: 244,
        fontWeight: 700,
        letterSpacing: -15,
        lineHeight: 0.88,
      },
      box({}, "YOUR CAMPUS"),
      box({ color: YELLOW }, "IS"),
      box(
        {
          alignSelf: "flex-start",
          marginTop: 24,
          padding: "16px 30px 25px",
          backgroundColor: INK,
          color: WHITE,
        },
        "HAPPENING.",
      ),
    ),
    horizontalRule({
      left: 150,
      top: 1328,
      width: 2020,
      height: 6,
      color: WHITE,
    }),
    indexLabels.map((label, index) =>
      keyedBox(
        `colour-index-${label}`,
        {
          position: "absolute",
          left: 150 + index * 505,
          top: 1375,
          width: 480,
          color: WHITE,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 4,
        },
        `${String(index + 1).padStart(2, "0")}  ${label}`,
      ),
    ),
    commonSupportLine({
      left: 150,
      top: 1640,
      color: INK,
      width: 2250,
    }),
    box(
      {
        position: "absolute",
        left: 425,
        top: 1732,
        width: 1700,
        height: 128,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: INK,
        color: WHITE,
        fontSize: 48,
        fontWeight: 700,
        letterSpacing: 6,
      },
      "SCAN FOR WHAT'S ON",
    ),
    box({
      position: "absolute",
      left: 390,
      top: 1732,
      width: 35,
      height: 128,
      backgroundColor: ORANGE,
    }),
    box({
      position: "absolute",
      left: 2125,
      top: 1732,
      width: 35,
      height: 128,
      backgroundColor: YELLOW,
    }),
    qrSlot(qr, { frameColor: BLUE, accentColor: ORANGE }),
    box(
      {
        position: "absolute",
        left: 112,
        top: 2170,
        width: 430,
        height: 112,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: YELLOW,
        color: INK,
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: 3,
        transform: "rotate(-90deg)",
      },
      "POINT CAMERA HERE",
    ),
    box({
      position: "absolute",
      left: 2040,
      top: 2220,
      width: 260,
      height: 260,
      borderRadius: 9999,
      backgroundColor: BLUE,
    }),
    box({
      position: "absolute",
      left: 2160,
      top: 2380,
      width: 190,
      height: 190,
      borderRadius: 9999,
      backgroundColor: ORANGE,
    }),
    box({
      position: "absolute",
      left: 1980,
      top: 2770,
      width: 360,
      height: 48,
      backgroundColor: YELLOW,
      transform: "rotate(-9deg)",
    }),
    microLabel({
      text: "ONE SCAN / A WHOLE CAMPUS",
      left: 90,
      top: 3137,
      color: INK,
      width: 520,
    }),
    microLabel({
      text: "OFFICIAL WAT2DO CAMPUS POSTER",
      left: 1680,
      top: 3137,
      color: INK,
      width: 760,
      align: "right",
    }),
  );
}

function blackWhitePoster(qr) {
  return posterFrame(
    WHITE,
    INK,
    box({
      position: "absolute",
      left: 90,
      top: 90,
      width: 2370,
      height: 3120,
      border: `5px solid ${INK}`,
    }),
    wordmark({ left: 145, top: 120 }),
    microLabel({
      text: "CAMPUS EDITION",
      left: 960,
      top: 145,
      width: 550,
      align: "center",
    }),
    microLabel({
      text: "ISSUE 01 / ALWAYS CURRENT",
      left: 1650,
      top: 145,
      width: 730,
      align: "right",
    }),
    horizontalRule({ left: 145, top: 245, width: 2260, height: 5 }),
    dotMatrix({
      left: 2090,
      top: 330,
      columns: 7,
      rows: 12,
      gap: 42,
      size: 16,
    }),
    box(
      {
        position: "absolute",
        left: 145,
        top: 330,
        flexDirection: "column",
        width: 2130,
        color: INK,
        fontSize: 248,
        fontWeight: 700,
        letterSpacing: -14,
        lineHeight: 0.88,
      },
      box({}, "YOUR CAMPUS"),
      box(
        {
          alignSelf: "flex-start",
          marginTop: 18,
          padding: "5px 28px 24px",
          backgroundColor: INK,
          color: WHITE,
        },
        "IS",
      ),
      box({ marginTop: 14 }, "HAPPENING."),
    ),
    commonSupportLine({
      left: 150,
      top: 1145,
      color: INK,
      width: 1850,
    }),
    horizontalRule({ left: 145, top: 1265, width: 2260, height: 5 }),
    box(
      {
        position: "absolute",
        left: 145,
        top: 1305,
        width: 2260,
        alignItems: "center",
        justifyContent: "space-between",
        color: INK,
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: 4,
      },
      box({}, "01 / EVENTS"),
      box({}, "02 / CLUBS"),
      box({}, "03 / PEOPLE"),
      box({}, "04 / PLACES"),
    ),
    horizontalRule({ left: 145, top: 1380, width: 2260, height: 5 }),
    box(
      {
        position: "absolute",
        left: 365,
        top: 1535,
        width: 1820,
        height: 160,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: INK,
        color: WHITE,
        fontSize: 51,
        fontWeight: 700,
        letterSpacing: 7,
      },
      "SCAN. PICK SOMETHING. GO.",
    ),
    box(
      {
        position: "absolute",
        left: 90,
        top: 2190,
        width: 470,
        color: INK,
        fontSize: 29,
        fontWeight: 700,
        letterSpacing: 5,
        transform: "rotate(-90deg)",
      },
      "EVENTS · CLUBS · PEOPLE · PLACES",
    ),
    box(
      {
        position: "absolute",
        left: 2015,
        top: 2380,
        flexDirection: "column",
        width: 360,
        color: INK,
      },
      box(
        {
          fontSize: 130,
          fontWeight: 700,
          letterSpacing: -8,
          lineHeight: 0.9,
        },
        "01",
      ),
      box({
        marginTop: 18,
        width: 260,
        height: 5,
        backgroundColor: INK,
      }),
      box(
        {
          marginTop: 20,
          width: 310,
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.3,
          letterSpacing: 3,
        },
        "YOUR CAMPUS, WITHOUT THE GROUP CHAT CHAOS.",
      ),
    ),
    qrSlot(qr, { frameColor: INK }),
    dotMatrix({
      left: 190,
      top: 2840,
      columns: 7,
      rows: 7,
      gap: 36,
      size: 12,
    }),
    microLabel({
      text: "POINT CAMERA AT THE SQUARE",
      left: 140,
      top: 3138,
      color: INK,
      width: 750,
    }),
    microLabel({
      text: "WAT2DO.IO",
      left: 1880,
      top: 3138,
      color: INK,
      width: 470,
      align: "right",
    }),
  );
}

function routeNode({ left, top, number, label, labelAbove = true }) {
  return [
    box({
      position: "absolute",
      left,
      top,
      width: 58,
      height: 58,
      borderRadius: 9999,
      border: `5px solid ${INK}`,
      backgroundColor: WHITE,
    }),
    box({
      position: "absolute",
      left: left + 19,
      top: top + 19,
      width: 20,
      height: 20,
      borderRadius: 9999,
      backgroundColor: BLUE,
    }),
    microLabel({
      text: `${number} / ${label}`,
      left: left - 55,
      top: labelAbove ? top - 62 : top + 88,
      color: INK,
      width: 260,
      fontSize: 25,
      letterSpacing: 3,
    }),
  ];
}

function lowInkPoster(qr) {
  return posterFrame(
    WHITE,
    INK,
    wordmark({ left: 150, top: 115 }),
    microLabel({
      text: "CAMPUS ROUTE / START HERE",
      left: 1480,
      top: 145,
      width: 900,
      align: "right",
    }),
    horizontalRule({ left: 150, top: 245, width: 2250, height: 4 }),
    box(
      {
        position: "absolute",
        left: 145,
        top: 350,
        flexDirection: "column",
        width: 2250,
        color: INK,
        fontSize: 232,
        fontWeight: 700,
        letterSpacing: -13,
        lineHeight: 0.9,
      },
      box({}, "YOUR CAMPUS"),
      box({}, "IS HAPPENING."),
    ),
    commonSupportLine({
      left: 150,
      top: 845,
      color: INK,
      width: 1850,
    }),
    box(
      {
        position: "absolute",
        left: 2065,
        top: 710,
        width: 190,
        height: 190,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9999,
        border: `5px solid ${INK}`,
      },
    ),
    horizontalRule({
      left: 2110,
      top: 802,
      width: 96,
      height: 5,
      color: BLUE,
    }),
    box({
      position: "absolute",
      left: 2170,
      top: 779,
      width: 48,
      height: 5,
      backgroundColor: BLUE,
      transform: "rotate(45deg)",
    }),
    box({
      position: "absolute",
      left: 2170,
      top: 825,
      width: 48,
      height: 5,
      backgroundColor: BLUE,
      transform: "rotate(-45deg)",
    }),
    horizontalRule({ left: 270, top: 1128, width: 1995, height: 5 }),
    routeNode({
      left: 390,
      top: 1101,
      number: "01",
      label: "EVENTS",
      labelAbove: true,
    }),
    routeNode({
      left: 960,
      top: 1101,
      number: "02",
      label: "CLUBS",
      labelAbove: false,
    }),
    routeNode({
      left: 1530,
      top: 1101,
      number: "03",
      label: "PEOPLE",
      labelAbove: true,
    }),
    routeNode({
      left: 2100,
      top: 1101,
      number: "04",
      label: "PLACES",
      labelAbove: false,
    }),
    verticalRule({ left: 417, top: 1159, height: 330, width: 5 }),
    horizontalRule({ left: 417, top: 1484, width: 1760, height: 5 }),
    verticalRule({ left: 2172, top: 1484, height: 305, width: 5 }),
    box(
      {
        position: "absolute",
        left: 585,
        top: 1590,
        width: 1380,
        height: 142,
        alignItems: "center",
        justifyContent: "center",
        border: `5px solid ${INK}`,
        color: INK,
        fontSize: 48,
        fontWeight: 700,
        letterSpacing: 6,
      },
      "SCAN FOR WHAT'S ON",
    ),
    box({
      position: "absolute",
      left: 2170,
      top: 1784,
      width: 22,
      height: 22,
      borderRadius: 9999,
      backgroundColor: BLUE,
    }),
    qrSlot(qr, { frameColor: INK, accentColor: BLUE, lowInk: true }),
    microLabel({
      text: "CAMERA",
      left: 180,
      top: 2020,
      color: INK,
      width: 340,
      fontSize: 26,
    }),
    horizontalRule({ left: 180, top: 2075, width: 350, height: 4 }),
    microLabel({
      text: "THIS WAY",
      left: 180,
      top: 2110,
      color: BLUE,
      width: 260,
      fontSize: 28,
    }),
    horizontalRule({
      left: 398,
      top: 2130,
      width: 76,
      height: 4,
      color: BLUE,
    }),
    box({
      position: "absolute",
      left: 446,
      top: 2111,
      width: 38,
      height: 4,
      backgroundColor: BLUE,
      transform: "rotate(45deg)",
    }),
    box({
      position: "absolute",
      left: 446,
      top: 2147,
      width: 38,
      height: 4,
      backgroundColor: BLUE,
      transform: "rotate(-45deg)",
    }),
    outlinedCircle({
      left: 2040,
      top: 2110,
      size: 170,
      color: INK,
      stroke: 4,
    }),
    outlinedCircle({
      left: 2085,
      top: 2155,
      size: 80,
      color: BLUE,
      stroke: 4,
    }),
    verticalRule({ left: 2168, top: 2280, height: 610, width: 4 }),
    routeNode({
      left: 2140,
      top: 2860,
      number: "05",
      label: "GO",
      labelAbove: false,
    }),
    microLabel({
      text: "ONE SCAN / A WHOLE CAMPUS",
      left: 140,
      top: 3138,
      color: INK,
      width: 700,
    }),
    microLabel({
      text: "LOW-INK EDITION",
      left: 1880,
      top: 3138,
      color: INK,
      width: 470,
      align: "right",
    }),
  );
}

const templateRenderers = new Map([
  ["campus-colour", colourPoster],
  ["campus-black-white", blackWhitePoster],
  ["campus-low-ink", lowInkPoster],
]);

function resolveQrSlot(template) {
  assert.equal(template.print_size, "us-letter");
  assert.equal(template.orientation, "portrait");

  const placement = template.qr_placement;
  const placementWidth = placement.width * PAGE_WIDTH;
  const placementHeight = placement.height * PAGE_HEIGHT;
  assert.ok(
    Math.abs(placementWidth - placementHeight) < 1,
    `${template.id} QR placement must remain square`,
  );

  const size = Math.round(Math.min(placementWidth, placementHeight));
  const left = Math.round(
    placement.x * PAGE_WIDTH + (placementWidth - size) / 2,
  );
  const top = Math.round(
    placement.y * PAGE_HEIGHT + (placementHeight - size) / 2,
  );

  assert.deepEqual(
    { left, top, size },
    { left: 675, top: 1914, size: 1200 },
    `${template.id} QR placement changed; review every layout before regenerating`,
  );
  return { left, top, size };
}

function resolveOutputPath(template) {
  assert.match(template.asset_path, /^\/poster-templates\/[^/]+\.png$/);
  const outputPath = path.resolve(
    frontendRoot,
    "public",
    template.asset_path.slice(1),
  );
  assert.ok(
    outputPath.startsWith(
      `${path.join(frontendRoot, "public", "poster-templates")}${path.sep}`,
    ),
    `Unsafe template output path: ${template.asset_path}`,
  );
  return outputPath;
}

function readPngDimensions(png) {
  assert.equal(
    png.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "Rendered artifact must be a PNG",
  );
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

async function loadFonts() {
  return Promise.all(
    FONT_FILES.map(async ({ file, weight }) => ({
      name: "Inter",
      data: await readFile(
        path.join(
          frontendRoot,
          "node_modules",
          "@fontsource",
          "inter",
          "files",
          file,
        ),
      ),
      weight,
      style: "normal",
    })),
  );
}

async function main() {
  const controlbox = JSON.parse(await readFile(controlboxPath, "utf8"));
  const templates = controlbox.approved_templates.filter(({ id }) =>
    EXPECTED_TEMPLATE_IDS.includes(id),
  );
  assert.deepEqual(
    templates.map(({ id }) => id).sort(),
    [...EXPECTED_TEMPLATE_IDS].sort(),
    "The approved poster template set no longer matches the code renderer",
  );

  const enabledUnmappedTemplates = controlbox.approved_templates
    .filter(({ available_for_creation }) => available_for_creation)
    .filter(({ id }) => !templateRenderers.has(id));
  assert.deepEqual(
    enabledUnmappedTemplates,
    [],
    "Every enabled poster template needs a code renderer",
  );

  const [fonts, wasm] = await Promise.all([
    loadFonts(),
    readFile(
      path.join(
        frontendRoot,
        "node_modules",
        "@resvg",
        "resvg-wasm",
        "index_bg.wasm",
      ),
    ),
  ]);
  await initWasm(wasm);

  for (const template of templates) {
    const renderTemplate = templateRenderers.get(template.id);
    assert.ok(renderTemplate, `No renderer for ${template.id}`);

    const qr = resolveQrSlot(template);
    const svg = await satori(renderTemplate(qr), {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      fonts,
    });
    const png = Buffer.from(
      new Resvg(svg, {
        fitTo: { mode: "width", value: PAGE_WIDTH },
        background: WHITE,
      })
        .render()
        .asPng(),
    );
    assert.deepEqual(readPngDimensions(png), {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });

    const outputPath = resolveOutputPath(template);
    await writeFile(outputPath, png);
    process.stdout.write(
      `Rendered ${template.id} -> ${path.relative(repositoryRoot, outputPath)}\n`,
    );
  }
}

await main();
