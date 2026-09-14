import { createElement } from "react";

export const LANDSCAPE_WIDTH = 1600;
export const LANDSCAPE_HEIGHT = 1000;
export const RECAP_WIDTH = 1080;
export const RECAP_HEIGHT = 1920;

const INK = "#111111";
const PAPER = "#FAFAF8";
const WHITE = "#FFFFFF";
const MUTED = "#777777";
const CLUB_BAR_COLORS = ["#F6D267", "#E37ABF", "#B99AE8", "#F0B64A", "#9DCED8"];
const AWARD_COLORS = ["#D9EDF7", "#FBF3C8", "#E8D9FA", "#F7DADB"];
const PIN_TAIL = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 34"><path d="M2 2h36L20 32 2 2Z" fill="#111111"/></svg>',
).toString("base64")}`;

function flatten(children) {
  return children.flat(8).filter((child) => child !== null && child !== undefined && child !== false);
}

function box(style, ...children) {
  return createElement("div", { style: { display: "flex", ...style } }, ...flatten(children));
}

function keyedBox(key, style, ...children) {
  return createElement(
    "div",
    { key, style: { display: "flex", ...style } },
    ...flatten(children),
  );
}

function image(src, style, key = undefined) {
  return createElement("img", { key, src, alt: "", style });
}

function frame(width, height, style, ...children) {
  return box(
    {
      width,
      height,
      position: "relative",
      overflow: "hidden",
      fontFamily: "Satoshi",
      backgroundColor: PAPER,
      color: INK,
      ...style,
    },
    children,
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function Mosaic({ sources }) {
  const columns = 7;
  const rows = 5;
  const columnWidth = LANDSCAPE_WIDTH / columns;
  const tileWidth = Math.ceil(columnWidth) + 2;
  const tileHeight = 260;
  const columnOffsets = [-96, -28, -76, -10, -112, -48, -88];
  const usable = sources.length > 0 ? sources : [""];
  return box(
    {
      position: "absolute",
      left: 0,
      top: 0,
      width: LANDSCAPE_WIDTH,
      height: LANDSCAPE_HEIGHT,
      backgroundColor: "#EAEAEA",
    },
    Array.from({ length: columns }, (_, column) =>
      Array.from({ length: rows }, (_, row) => {
        const index = column * rows + row;
        const source = usable[index % usable.length];
        return keyedBox(
          `mosaic-${column}-${row}`,
          {
            position: "absolute",
            left: Math.floor(column * columnWidth),
            top: columnOffsets[column] + row * tileHeight,
            width: tileWidth,
            height: tileHeight,
            overflow: "hidden",
            backgroundColor: index % 2 === 0 ? "#D9D9D9" : "#EFEFEF",
          },
          source
            ? image(source, {
                width: tileWidth,
                height: tileHeight,
                objectFit: "cover",
                opacity: 0.23,
                filter: "grayscale(1) contrast(1.2)",
              })
            : null,
        );
      }),
    ),
    box({
      position: "absolute",
      inset: 0,
      width: LANDSCAPE_WIDTH,
      height: LANDSCAPE_HEIGHT,
      backgroundColor: "rgba(255,255,255,0.46)",
    }),
  );
}

function Logo({ src, left, top, size, backgroundColor = "transparent" }) {
  return box(
    {
      position: "absolute",
      left,
      top,
      width: size,
      height: size,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 24,
      backgroundColor,
      overflow: "hidden",
    },
    image(src, { width: size, height: size, objectFit: "contain" }),
  );
}

function Qr({ src, left, top, size, caption = "" }) {
  return box(
    {
      position: "absolute",
      left,
      top,
      width: size,
      flexDirection: "column",
      alignItems: "center",
    },
    box(
      {
        width: size,
        height: size,
        backgroundColor: WHITE,
        border: `4px solid ${INK}`,
        padding: 8,
      },
      image(src, { width: size - 24, height: size - 24 }),
    ),
    caption
      ? box(
          {
            width: size + 60,
            marginTop: 8,
            justifyContent: "center",
            textAlign: "center",
            color: WHITE,
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1.05,
            WebkitTextStroke: `4px ${INK}`,
          },
          caption,
        )
      : null,
  );
}

function outlinedHeadline(lines) {
  const maximumLength = Math.max(...lines.map((line) => line.length));
  const fontSize = maximumLength > 27 ? 76 : maximumLength > 21 ? 86 : 96;
  return box(
    {
      position: "absolute",
      left: 54,
      right: 45,
      top: 178,
      flexDirection: "column",
      fontSize,
      fontWeight: 700,
      lineHeight: 0.98,
      letterSpacing: -3,
      textTransform: "uppercase",
      color: WHITE,
      WebkitTextStroke: `8px ${INK}`,
      whiteSpace: "nowrap",
    },
    lines.map((line, index) => keyedBox(`headline-${index}`, { height: fontSize + 8 }, line)),
  );
}

export function SchoolClaimPoster({ model, assets, kind }) {
  const isClubs = kind === "clubs";
  const count = isClubs
    ? model.claims.observed_club_count
    : model.claims.all_time_event_count;
  const lines = isClubs
    ? [
        `WE OBSERVE ${formatNumber(count)}`,
        `${model.school.name} CLUBS SO`,
        "STUDENTS TRY MORE",
        "NEW THINGS",
      ]
    : [
        `WE FOUND ${formatNumber(count)}`,
        "EVENTS SO STUDENTS",
        "TRY MORE NEW THINGS",
      ];
  const siteLabel = model.school.site_url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return frame(
    LANDSCAPE_WIDTH,
    LANDSCAPE_HEIGHT,
    { backgroundColor: WHITE },
    createElement(Mosaic, { sources: model.background_images }),
    createElement(Logo, {
      src: assets.logo,
      left: 52,
      top: 42,
      size: 112,
      backgroundColor: model.school.primary_color,
    }),
    outlinedHeadline(lines),
    box(
      {
        position: "absolute",
        left: 52,
        bottom: 54,
        height: 90,
        padding: "0 44px",
        alignItems: "center",
        borderRadius: 999,
        backgroundColor: INK,
        color: WHITE,
        fontSize: 48,
        fontWeight: 700,
      },
      `Visit ${siteLabel}`,
    ),
    createElement(Qr, {
      src: assets.qr,
      left: 1354,
      top: 748,
      size: 186,
    }),
  );
}

function CircleImage({ src, size = 54, fallbackColor = "#D9E6EA" }) {
  return box(
    {
      width: size,
      height: size,
      minWidth: size,
      borderRadius: 999,
      border: `2px solid ${INK}`,
      overflow: "hidden",
      backgroundColor: fallbackColor,
      alignItems: "center",
      justifyContent: "center",
    },
    src ? image(src, { width: size, height: size, objectFit: "cover" }) : null,
  );
}

function TopClubs({ clubs }) {
  const maxCount = Math.max(1, ...clubs.map((club) => club.event_count));
  const barWidth = 320;
  return box(
    { width: 500, flexDirection: "column" },
    box({ fontSize: 32, fontWeight: 700, marginBottom: 18 }, "Top 5 Clubs by Events"),
    clubs.length === 0
      ? box({ fontSize: 22, color: MUTED }, "No clubs hosted an event in this term yet.")
      : clubs.map((club, index) =>
          keyedBox(
            `club-${club.handle}-${index}`,
            { height: 72, alignItems: "center", marginBottom: 8 },
            box({ width: 36, fontSize: 23, fontWeight: 700 }, `${index + 1}.`),
            createElement(CircleImage, { src: club.logo_url }),
            box(
              {
                position: "relative",
                width: barWidth,
                height: 54,
                marginLeft: 12,
                alignItems: "center",
                border: `2px solid ${INK}`,
                backgroundColor: "#F1F1ED",
                fontSize: 19,
                fontWeight: 700,
              },
              box({
                position: "absolute",
                left: 0,
                top: 0,
                width: Math.round(barWidth * (club.event_count / maxCount)),
                height: 54,
                backgroundColor: CLUB_BAR_COLORS[index],
              }),
              box(
                {
                  position: "absolute",
                  left: 14,
                  right: 14,
                  top: 0,
                  height: 54,
                  alignItems: "center",
                  justifyContent: "space-between",
                },
              box(
                {
                  maxWidth: 220,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
                club.handle,
              ),
              box({ marginLeft: 10 }, formatNumber(club.event_count)),
              ),
            ),
          ),
        ),
  );
}

function FoodPanel({ recap }) {
  const mentionLine = recap.food_mentions.length
    ? recap.food_mentions
        .map(({ label, count }) => `${formatNumber(count)} mention ${label}`)
        .join(", ")
    : "Structured food details are still arriving.";
  return box(
    { width: 500, flexDirection: "column" },
    box(
      { fontSize: 32, fontWeight: 700 },
      `${formatNumber(recap.food_linked_event_count)} Food-Linked Events`,
    ),
    box({ marginTop: 8, fontSize: 21, fontWeight: 600, lineHeight: 1.35, color: MUTED }, mentionLine),
    box(
      { marginTop: 24, gap: 28 },
      recap.food_examples.map((event, index) =>
        keyedBox(
          `food-example-${index}`,
          { width: 190, flexDirection: "column" },
          image(event.image_url, {
            width: 190,
            height: 190,
            border: `2px solid ${INK}`,
            objectFit: "cover",
          }),
          box(
            {
              marginTop: 10,
              width: 190,
              maxHeight: 84,
              overflow: "hidden",
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1.15,
            },
            event.title,
          ),
        ),
      ),
    ),
  );
}

function Divider({ top }) {
  return box({ position: "absolute", left: 0, top, width: RECAP_WIDTH, height: 2, backgroundColor: INK });
}

function Heatmap({ days, start }) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const mondayIndex = (startDate.getUTCDay() + 6) % 7;
  const maximum = Math.max(1, ...days.map((day) => day.count));
  const cell = 16;
  const gap = 5;
  const width = 500;
  return box(
    { position: "relative", width, height: 180 },
    days.map((day, index) => {
      const position = mondayIndex + index;
      const column = Math.floor(position / 7);
      const row = position % 7;
      const opacity = day.count === 0 ? 0.08 : 0.22 + 0.78 * (day.count / maximum);
      return keyedBox(`day-${day.date}`, {
        position: "absolute",
        left: 56 + column * (cell + gap),
        top: 30 + row * (cell + gap),
        width: cell,
        height: cell,
        borderRadius: 5,
        backgroundColor: day.count === 0 ? "#AAB6BB" : `rgba(33, 190, 86, ${opacity})`,
      });
    }),
    box({ position: "absolute", left: 0, top: 50, fontSize: 15, fontWeight: 700, color: MUTED }, "Mon"),
    box({ position: "absolute", left: 0, top: 92, fontSize: 15, fontWeight: 700, color: MUTED }, "Wed"),
    box({ position: "absolute", left: 0, top: 134, fontSize: 15, fontWeight: 700, color: MUTED }, "Fri"),
  );
}

function AwardCard({ award, index }) {
  return box(
    {
      width: 492,
      height: 180,
      padding: 20,
      border: `2px solid ${INK}`,
      backgroundColor: AWARD_COLORS[index],
      alignItems: "flex-start",
    },
    box(
      { width: 84, flexDirection: "column", alignItems: "center" },
      createElement(CircleImage, { src: award.logo_url, size: 62 }),
      image(PIN_TAIL, { width: 36, height: 31, marginTop: -4 }),
    ),
    box(
      { flex: 1, marginLeft: 16, flexDirection: "column" },
      box({ fontSize: 27, fontWeight: 700, lineHeight: 1.05 }, award.title),
      award.handle
        ? box({ marginTop: 5, fontSize: 18, fontWeight: 700 }, award.handle)
        : box({ marginTop: 5, fontSize: 18, fontWeight: 700 }, award.club),
      box({ marginTop: 5, fontSize: 18, fontWeight: 600, lineHeight: 1.2 }, award.description),
    ),
  );
}

export function SchoolRecapPoster({ model, assets }) {
  const { recap, school, term } = model;
  return frame(
    RECAP_WIDTH,
    RECAP_HEIGHT,
    { backgroundColor: PAPER },
    box({
      position: "absolute",
      left: 0,
      top: 0,
      width: RECAP_WIDTH,
      height: 380,
      backgroundColor: school.primary_color,
    }),
    createElement(Logo, { src: assets.logo, left: 20, top: 18, size: 105 }),
    box(
      {
        position: "absolute",
        top: 103,
        left: 200,
        width: 680,
        justifyContent: "center",
        color: school.secondary_color,
        fontSize: 164,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: -8,
      },
      formatNumber(recap.event_count),
    ),
    box(
      {
        position: "absolute",
        top: 288,
        left: 120,
        width: 840,
        justifyContent: "center",
        textAlign: "center",
        color: school.secondary_color,
        fontSize: 33,
        fontWeight: 700,
        textTransform: "uppercase",
      },
      `${term.label} EVENTS AT ${school.name}`,
    ),
    createElement(Qr, { src: assets.qr, left: 878, top: 24, size: 170, caption: "Scan to see each event!" }),

    box(
      { position: "absolute", left: 28, top: 430, width: 1024, justifyContent: "space-between" },
      createElement(TopClubs, { clubs: recap.top_clubs }),
      createElement(FoodPanel, { recap }),
    ),
    createElement(Divider, { top: 930 }),

    box(
      { position: "absolute", left: 28, top: 1008, width: 430, flexDirection: "column" },
      box(
        { fontSize: 35, fontWeight: 700, lineHeight: 1.15 },
        recap.busiest_date.count > 0
          ? `${formatNumber(recap.busiest_date.count)} Events Happened On ${recap.busiest_date.label}`
          : "No Events Have Happened Yet",
      ),
      box(
        { marginTop: 38, fontSize: 21, fontWeight: 600, lineHeight: 1.35, color: MUTED },
        `${recap.busiest_weekday}s were busiest for ${school.name.toUpperCase()}, while ${recap.quietest_weekday}s were the quietest.`,
      ),
    ),
    box(
      { position: "absolute", left: 520, top: 1000, width: 530 },
      createElement(Heatmap, { days: recap.heatmap, start: term.start }),
    ),
    createElement(Divider, { top: 1282 }),

    box(
      { position: "absolute", left: 28, top: 1332, fontSize: 35, fontWeight: 700 },
      "Awards Row",
    ),
    box(
      {
        position: "absolute",
        left: 28,
        top: 1390,
        width: 1024,
        flexWrap: "wrap",
        gap: 20,
      },
      recap.awards.map((award, index) =>
        createElement(AwardCard, { key: award.title, award, index }),
      ),
    ),
    box(
      {
        position: "absolute",
        left: 20,
        bottom: 4,
        width: 1040,
        justifyContent: "space-between",
      },
      Array.from({ length: 9 }, (_, index) =>
        image(assets.goose, { width: 70, height: 47, objectFit: "contain" }, `goose-${index}`),
      ),
    ),
  );
}
