/**
 * The carousel slide markup.
 *
 * These are the only components in the app written with inline style objects
 * instead of design-system primitives: they are rasterized by satori in
 * `/api/render-instagram-slide`, which supports flexbox and inline styles only.
 * That constraint - no hooks, no measurement, no CSS variables - is why the
 * slide templates own their print layout instead of rendering app components.
 */

import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SLIDE_POSTER_REGIONS,
  type CoverSlideModel,
  type EventSlideModel,
} from "@/features/admin/lib/instagramSlides";

// Light-theme functional tokens, resolved from styles/functional-tokens.css.
// Satori cannot resolve CSS variables, so artwork uses their concrete values.
const LIGHT = {
  surface: "#ffffff",
  secondary: "#e9e9e9",
  foreground: "#171717",
  mutedForeground: "#5c5c5c",
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

const EVENT_HEADER_HEIGHT = 132;
const EVENT_CONTENT_INSET = 32;

/** The browser preview and Satori both support this exact ellipsis contract. */
function clampText(lines: number): React.CSSProperties {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
    textOverflow: "ellipsis",
    wordBreak: "break-word",
    margin: 0,
    flexShrink: 0,
  };
}

export interface SlidePosterProps {
  src: string;
  width: number;
  height: number;
  fallback?: React.ReactNode;
}

type PosterRenderer = (props: SlidePosterProps) => React.ReactNode;

/** Publishing consumes prepared PNGs; the browser preview supplies native lazy images. */
const renderSlidePoster: PosterRenderer = ({ src, width, height }) => (
  <img src={src} width={width} height={height} style={{ width, height, objectFit: "cover" }} alt="" />
);

/** Avatars share one crop and initials fallback in headers and comments. */
function SlideAvatar({ src, author, size, renderPoster }: { src: string; author: string; size: number; renderPoster: PosterRenderer }) {
  const initials = author.slice(0, 2).toUpperCase();
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: size / 2, overflow: "hidden", flexShrink: 0, backgroundColor: LIGHT.secondary, fontSize: size / 3, fontWeight: 700 }}>
    {src ? renderPoster({ src, width: size, height: size, fallback: initials }) : initials}
  </div>;
}

/** An Instagram-style post with a taller photo and two compact comments. */
export function EventSlideTemplate({ model, renderPoster = renderSlidePoster }: { model: EventSlideModel; renderPoster?: PosterRenderer }) {
  const poster = SLIDE_POSTER_REGIONS.event;
  const schedule = [model.dateLine, model.timeLine].filter(Boolean).join(" · ");
  return (
    <div style={{ ...slideFrame, backgroundColor: LIGHT.surface, color: LIGHT.foreground, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24, height: EVENT_HEADER_HEIGHT, padding: `12px ${EVENT_CONTENT_INSET}px`, flexShrink: 0 }}>
        <SlideAvatar src={model.avatarSrc} author={model.author} size={SLIDE_POSTER_REGIONS.avatar.width} renderPoster={renderPoster} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 3 }}>
          <p style={{ ...clampText(1), fontSize: 32, fontWeight: 700, lineHeight: 1.2, maxHeight: 39 }}>{model.author}</p>
          {model.location ? <p style={{ ...clampText(1), fontSize: 24, lineHeight: 1.2, maxHeight: 29 }}>{model.location}</p> : null}
          {schedule ? <p style={{ ...clampText(1), fontSize: 24, lineHeight: 1.2, maxHeight: 29, color: LIGHT.mutedForeground }}>{schedule}</p> : null}
        </div>
      </div>
      <div style={{ display: "flex", position: "relative", alignItems: "center", justifyContent: "center", ...poster, flexShrink: 0, overflow: "hidden", backgroundColor: LIGHT.secondary }}>
        {model.imageSrc ? renderPoster({ src: model.imageSrc, ...poster })
          : <p style={{ ...clampText(4), margin: EVENT_CONTENT_INSET * 2, fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>{model.title}</p>}
        <div style={{ display: "flex", position: "absolute", bottom: 20, left: EVENT_CONTENT_INSET, padding: 5, borderRadius: 48, backgroundColor: LIGHT.surface }}>
          <SlideAvatar src={model.siteAvatarSrc} author={model.siteName} size={72} renderPoster={renderSlidePoster} />
          <svg width="30" height="30" viewBox="0 0 24 24" style={{ position: "absolute", right: -6, bottom: -2 }}><path d="M12 21 3 12C-3 5 6-1 12 6 18-1 27 5 21 12Z" fill="#ed4956" stroke="white" strokeWidth="2" /></svg>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: `12px ${EVENT_CONTENT_INSET}px`, gap: 12, flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 16 }}>
          <SlideAvatar src={model.avatarSrc} author={model.author} size={52} renderPoster={renderPoster} />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <p style={{ ...clampText(1), fontSize: 26, fontWeight: 700, lineHeight: 1.2, maxHeight: 32 }}>{model.author}</p>
            <p style={{ ...clampText(2), fontSize: 26, lineHeight: 1.2, maxHeight: 63 }}>{model.description}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <SlideAvatar src={model.siteAvatarSrc} author={model.siteName} size={52} renderPoster={renderSlidePoster} />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 4 }}>
            <p style={{ ...clampText(1), fontSize: 26, fontWeight: 700, lineHeight: 1.2, height: 32, width: "100%", maxHeight: 32 }}>{model.siteName}</p>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {model.mapSrc ? <img src={model.mapSrc} {...SLIDE_POSTER_REGIONS.map} alt="" style={{ ...SLIDE_POSTER_REGIONS.map, objectFit: "cover", borderRadius: 12 }} /> : null}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 4, fontSize: 24, lineHeight: 1.2 }}>
                {model.location ? <p style={{ ...clampText(1), maxHeight: 29 }}>{model.location}</p> : null}
                {model.hiringLine ? <p style={{ ...clampText(2), maxHeight: 58 }}>{model.hiringLine}</p> : null}
                {model.badges.length ? <p style={{ ...clampText(1), maxHeight: 29, color: LIGHT.mutedForeground }}>{model.badges.join(" · ")}</p> : null}
              </div>
            </div>
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
            {renderPoster({ src: tile, width: FAN_CARD_WIDTH, height: FAN_CARD_HEIGHT })}
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
