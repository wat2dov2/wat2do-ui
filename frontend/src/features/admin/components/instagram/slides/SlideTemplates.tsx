/**
 * The carousel slide markup.
 *
 * These are the only components in the app written with inline style objects
 * instead of design-system primitives: they are rasterized by satori in
 * `/api/render-instagram-slide`, which supports flexbox and inline styles only.
 * That constraint - no hooks, no measurement, no CSS variables - is why the
 * event slide restates the event card instead of rendering it.
 */

import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SLIDE_POSTER_REGIONS,
  type CoverSlideModel,
  type EventSlideModel,
} from "@/features/admin/lib/instagramSlides";

// Dark-theme functional tokens, resolved from styles/functional-tokens.css.
// satori has no CSS variables, so the event slide carries the same values the
// app's dark mode computes.
const DARK = {
  background: "#0f0f0f",
  surface: "#171717",
  secondary: "#242424",
  foreground: "#f5f5f5",
  mutedForeground: "#949494",
  categoryInk: "#1A1A1A",
} as const;

/** Both slides fill the frame and set their own colours on top of it. */
const slideFrame: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: SLIDE_WIDTH,
  height: SLIDE_HEIGHT,
  fontFamily: "Satoshi",
  position: "relative",
};

const CARD_WIDTH = SLIDE_POSTER_REGIONS.event.width;
const CARD_INSET = (SLIDE_WIDTH - CARD_WIDTH) / 2;
const CARD_IMAGE_HEIGHT = SLIDE_POSTER_REGIONS.event.height;

export interface SlidePosterProps {
  src: string;
  width: number;
  height: number;
  fit: "contain" | "cover";
}

type PosterRenderer = (props: SlidePosterProps) => React.ReactNode;

/** Publishing consumes prepared PNGs; the browser preview supplies native lazy images. */
const renderSlidePoster: PosterRenderer = ({ src, width, height, fit }) => (
  <img src={src} width={width} height={height} style={{ width, height, objectFit: fit }} alt="" />
);

/** The complete poster stays unobscured; labels belong in the bounded caption. */
export function EventSlideTemplate({ model, renderPoster = renderSlidePoster }: { model: EventSlideModel; renderPoster?: PosterRenderer }) {
  return (
    <div style={{ ...slideFrame, backgroundColor: DARK.background, color: DARK.foreground, padding: CARD_INSET }}>
      <div style={{ display: "flex", flexDirection: "column", width: CARD_WIDTH, height: SLIDE_HEIGHT - CARD_INSET * 2, borderRadius: 36, backgroundColor: DARK.surface, overflow: "hidden" }}>
        <div style={{ display: "flex", width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT, flexShrink: 0, backgroundColor: DARK.secondary }}>
          {model.imageSrc ? (
            renderPoster({ src: model.imageSrc, width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT, fit: "contain" })
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "20px 32px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 36, flexShrink: 0 }}>
            <div style={{ display: "flex", backgroundColor: model.category.color, color: DARK.categoryInk, borderRadius: 12, padding: "4px 12px", fontSize: 24, fontWeight: 700 }}>
              {model.category.label}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 24 }}>
              {model.badges.map(badge => <div key={badge} style={{ display: "flex" }}>{badge}</div>)}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 48, fontWeight: 600, lineHeight: 1.05, maxHeight: 102, overflow: "hidden", marginTop: 12, flexShrink: 0 }}>
            {model.title}
          </div>
          {model.clubLine ? <div style={{ display: "flex", fontSize: 28, lineHeight: 1.15, maxHeight: 33, overflow: "hidden", marginTop: 6, flexShrink: 0 }}>{model.clubLine}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", fontSize: 30, lineHeight: 1.15, color: DARK.mutedForeground, marginTop: 12 }}>
            {model.dateLine ? <div style={{ display: "flex" }}>{model.dateLine}</div> : null}
            {model.timeLine ? <div style={{ display: "flex" }}>{model.timeLine}</div> : null}
            {model.location ? <div style={{ display: "flex", maxHeight: 35, overflow: "hidden" }}>{model.location}</div> : null}
          </div>
          {model.addedLine ? <div style={{ display: "flex", fontSize: 24, color: DARK.mutedForeground, marginTop: "auto", paddingTop: 12, flexShrink: 0 }}>{model.addedLine}</div> : null}
        </div>
      </div>
    </div>
  );
}

const COVER_MARGIN = 72;
const COVER_CONTENT_WIDTH = SLIDE_WIDTH - COVER_MARGIN * 2;
const COVER_DOODLE_COLUMNS = 6;
const COVER_DOODLE_CELL_SIZE = 210;
const COVER_DOODLE_ICON_SIZE = 72;
/** The poster fan sits on a fixed baseline so the copy above it never reflows. */
const FAN_TOP = 760;
const FAN_CARD_WIDTH = SLIDE_POSTER_REGIONS.cover.width;
const FAN_CARD_HEIGHT = SLIDE_POSTER_REGIONS.cover.height;
/** How far the outer cards may dip below the baseline as the fan curves. */
const FAN_MAX_DIP = 16;
/** Tilt of the outermost card; the rest interpolate towards flat at the centre. */
const FAN_MAX_TILT = 8;
/** Cards always bite into each other, however few of them there are. */
const FAN_MIN_OVERLAP = 50;

/**
 * The fanned poster row, laid out by hand.
 *
 * satori has no transform-origin and no negative margins, so each card is
 * absolutely placed. The step between cards is whatever makes the row fill the
 * content width - so nine posters tuck in tightly and two sit loosely - and the
 * tilt runs from `-FAN_MAX_TILT` on the left to `+FAN_MAX_TILT` on the right so
 * the middle of the fan stays upright. The row is centred, and its lowest card
 * clears the footer by design: `FAN_TOP + FAN_CARD_HEIGHT + FAN_MAX_DIP` must
 * stay above `SLIDE_HEIGHT - COVER_MARGIN`.
 */
function CoverPosterFan({ tiles, secondary, renderPoster }: { tiles: string[]; secondary: string; renderPoster: PosterRenderer }) {
  if (tiles.length === 0) return null;

  const step =
    tiles.length > 1
      ? Math.min(
          FAN_CARD_WIDTH - FAN_MIN_OVERLAP,
          (COVER_CONTENT_WIDTH - FAN_CARD_WIDTH) / (tiles.length - 1),
        )
      : 0;
  const rowWidth = FAN_CARD_WIDTH + step * (tiles.length - 1);
  const rowLeft = Math.round((SLIDE_WIDTH - rowWidth) / 2);
  const middle = (tiles.length - 1) / 2;

  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left: 0,
        top: 0,
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
      }}
    >
      {tiles.map((tile, index) => {
        const offset = middle === 0 ? 0 : (index - middle) / middle;
        return (
          <div
            key={`${tile}-${index}`}
            style={{
              display: "flex",
              position: "absolute",
              left: Math.round(rowLeft + step * index),
              top: FAN_TOP + Math.round(Math.abs(offset) * FAN_MAX_DIP),
              width: FAN_CARD_WIDTH,
              height: FAN_CARD_HEIGHT,
              borderRadius: 22,
              border: `3px solid ${secondary}`,
              overflow: "hidden",
              transform: `rotate(${(offset * FAN_MAX_TILT).toFixed(2)}deg)`,
            }}
          >
            {renderPoster({ src: tile, width: FAN_CARD_WIDTH, height: FAN_CARD_HEIGHT, fit: "cover" })}
          </div>
        );
      })}
    </div>
  );
}

/** The canonical Wat2Do cover mark, recoloured by the cover model. */
const COVER_LOGO_SIZE = 132;

/*
 * The mark sits centred in a 1080 square with 195 units of padding either side
 * and 297 above and below. That square is filled with the school colour, which
 * on the cover matches the background - so only the goose reads, and it looks
 * pushed down and left of every other edge on the slide by exactly that
 * padding. Pulling the box out by it puts the goose's own edges on the margin
 * the rest of the content uses.
 */
const COVER_LOGO_INK_INSET_X = Math.round((195 / 1080) * COVER_LOGO_SIZE);
const COVER_LOGO_INK_INSET_Y = Math.round((297 / 1080) * COVER_LOGO_SIZE);

function CoverLogo({ src }: { src: string }) {
  return (
    <img
      src={src}
      width={COVER_LOGO_SIZE}
      height={COVER_LOGO_SIZE}
      alt=""
      style={{
        width: COVER_LOGO_SIZE,
        height: COVER_LOGO_SIZE,
        marginTop: -COVER_LOGO_INK_INSET_Y,
        marginRight: -COVER_LOGO_INK_INSET_X,
      }}
    />
  );
}

/** A tilted, low-opacity field matching the app and drawer decoration. */
function CoverDoodleField({ icons }: { icons: string[] }) {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        flexWrap: "wrap",
        left: -90,
        top: -70,
        width: COVER_DOODLE_COLUMNS * COVER_DOODLE_CELL_SIZE,
        opacity: 0.08,
        transform: "rotate(-9deg)",
      }}
    >
      {icons.map((icon, index) => (
        <div
          key={`${icon}-${index}`}
          style={{
            display: "flex",
            width: COVER_DOODLE_CELL_SIZE,
            height: COVER_DOODLE_CELL_SIZE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={icon}
            width={COVER_DOODLE_ICON_SIZE}
            height={COVER_DOODLE_ICON_SIZE}
            alt=""
            style={{
              width: COVER_DOODLE_ICON_SIZE,
              height: COVER_DOODLE_ICON_SIZE,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The carousel cover.
 *
 * Every value on it comes from the batch - the school's colours, its local
 * date, how many events the scrape found, and the posters of the events on the
 * carousel - so the same batch always draws the same cover and nothing about it
 * is stored. The admin editor renders this exact component, scaled down.
 */
export function CoverSlideTemplate({ model, renderPoster = renderSlidePoster }: { model: CoverSlideModel; renderPoster?: PosterRenderer }) {
  const { primary, secondary } = model.colors;

  return (
    <div style={{ ...slideFrame, backgroundColor: primary, color: secondary, overflow: "hidden" }}>
      <CoverDoodleField icons={model.doodleIcons} />

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: `${COVER_MARGIN}px ${COVER_MARGIN}px 0 ${COVER_MARGIN}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 42,
            fontWeight: 700,
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          {model.dateLine}
        </div>
        <CoverLogo src={model.logoSrc} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: `0 ${COVER_MARGIN}px`,
          marginTop: 24,
        }}
      >
        <div style={{ display: "flex", fontSize: 240, fontWeight: 700, lineHeight: 1 }}>
          {String(model.newEventCount)}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            fontSize: 70,
            fontWeight: 700,
            lineHeight: 1.05,
            maxWidth: COVER_CONTENT_WIDTH,
          }}
        >
          {model.headline}
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: model.body.length > 75 ? 24 : 38, fontWeight: 500 }}>
          {model.body}
        </div>
      </div>

      <CoverPosterFan tiles={model.tiles} secondary={secondary} renderPoster={renderPoster} />

      <div
        style={{
          display: "flex",
          position: "absolute",
          left: COVER_MARGIN,
          bottom: COVER_MARGIN,
          width: COVER_CONTENT_WIDTH,
          justifyContent: "space-between",
          fontSize: 30,
          fontWeight: 700,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {model.swipeLine}
          {/* Vector hand keeps the pointing cue identical in Satori and browsers. */}
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M5 18h7l5-9c2-3 6-1 5 2l-2 5h15c5 0 5 6 0 6H24v9c0 4-3 6-6 5l-6-3H5Z" fill="#ffcc4d" stroke="#d99e29" strokeWidth="2" strokeLinejoin="round" />
            <path d="M24 24h-6m6 5h-6m4 5h-4" fill="none" stroke="#d99e29" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ display: "flex" }}>{model.siteLine}</div>
      </div>
    </div>
  );
}
