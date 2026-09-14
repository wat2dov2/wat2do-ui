/**
 * The carousel slide markup.
 *
 * These are the only components in the app written with inline style objects
 * instead of design-system primitives: they are rasterized by satori in
 * `/api/render-instagram-slide`, which supports flexbox and inline styles only.
 * That constraint - no hooks, no measurement, no CSS variables - is why the
 * event slide restates the event card instead of rendering it.
 */

import { SlideBadgeMask } from "@/features/admin/components/instagram/slides/SlideBadgeMask";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type CoverSlideModel,
  type EventSlideModel,
} from "@/features/admin/lib/instagramSlides";

// Dark-theme functional tokens, resolved from styles/functional-tokens.css.
// satori has no CSS variables, so the event slide carries the same values the
// app's dark mode computes.
const DARK = {
  background: "#0f0f0f",
  surface: "#171717",
  border: "#292929",
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

const CARD_INSET = 60;
const CARD_WIDTH = SLIDE_WIDTH - CARD_INSET * 2;
const CARD_IMAGE_HEIGHT = 780;

/**
 * One event, rendered as the app's event card in dark mode.
 *
 * Same anatomy as EventCard: poster with the category chip top-left and the
 * club badge bottom-left, then a surface body holding the title, the
 * date/time/location column, and the price / free-food chips. Click and going
 * counts are deliberately absent - a published slide is not a live card.
 *
 * The admin editor previews the real card, not this, so a change to EventCard's
 * anatomy will not show up here on its own. Keep the two in step by hand.
 */
export function EventSlideTemplate({ model }: { model: EventSlideModel }) {
  return (
    <div
      style={{
        ...slideFrame,
        backgroundColor: DARK.background,
        color: DARK.foreground,
        alignItems: "center",
        justifyContent: "center",
        padding: CARD_INSET,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: CARD_WIDTH,
          borderRadius: 36,
          border: `2px solid ${DARK.border}`,
          backgroundColor: DARK.surface,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", position: "relative", width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT }}>
          {model.imageSrc ? (
            <img
              src={model.imageSrc}
              width={CARD_WIDTH}
              height={CARD_IMAGE_HEIGHT}
              style={{ width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT, objectFit: "cover" }}
              alt=""
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: CARD_WIDTH,
                height: CARD_IMAGE_HEIGHT,
                backgroundColor: DARK.secondary,
              }}
            />
          )}

          {/*
           * Corner-notched like the card, rather than pills floating on the
           * poster: the badge sits in a bite taken out of the artwork.
           */}
          <SlideBadgeMask variant="top-left" color={DARK.background}>
            <div
              style={{
                display: "flex",
                backgroundColor: model.category.color,
                color: DARK.categoryInk,
                borderRadius: 36,
                padding: "10px 22px",
                fontSize: 34,
                fontWeight: 700,
              }}
            >
              {model.category.label}
            </div>
          </SlideBadgeMask>

          <SlideBadgeMask variant="bottom-left" color={DARK.background}>
            <div
              style={{
                display: "flex",
                maxWidth: CARD_WIDTH - 120,
                backgroundColor: DARK.background,
                border: `2px solid ${DARK.foreground}`,
                color: DARK.foreground,
                borderRadius: 36,
                padding: "10px 22px",
                fontSize: 34,
                fontWeight: 700,
              }}
            >
              {model.clubLine}
            </div>
          </SlideBadgeMask>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "32px 40px 36px 40px" }}>
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.05,
              maxHeight: 136,
              overflow: "hidden",
            }}
          >
            {model.title}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 24,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", color: DARK.mutedForeground }}>
              <div style={{ display: "flex", fontSize: 38 }}>{model.dateLine}</div>
              {model.timeLine ? (
                <div style={{ display: "flex", marginTop: 8, fontSize: 38 }}>{model.timeLine}</div>
              ) : null}
              <div style={{ display: "flex", marginTop: 8, fontSize: 38 }}>{model.location}</div>
            </div>

            {model.badges.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  marginLeft: 24,
                }}
              >
                {model.badges.map((badge) => (
                  <div
                    key={badge}
                    style={{
                      display: "flex",
                      marginTop: 10,
                      border: `2px solid ${DARK.border}`,
                      color: DARK.foreground,
                      borderRadius: 16,
                      padding: "6px 16px",
                      fontSize: 30,
                      fontWeight: 500,
                    }}
                  >
                    {badge}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
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
const FAN_CARD_WIDTH = 220;
const FAN_CARD_HEIGHT = 308;
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
function CoverPosterFan({ tiles, secondary }: { tiles: string[]; secondary: string }) {
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
            <img
              src={tile}
              width={FAN_CARD_WIDTH}
              height={FAN_CARD_HEIGHT}
              style={{ width: FAN_CARD_WIDTH, height: FAN_CARD_HEIGHT, objectFit: "cover" }}
              alt=""
            />
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
export function CoverSlideTemplate({ model }: { model: CoverSlideModel }) {
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

      <CoverPosterFan tiles={model.tiles} secondary={secondary} />

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
