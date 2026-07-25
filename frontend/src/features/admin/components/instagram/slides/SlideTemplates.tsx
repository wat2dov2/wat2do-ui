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
  type CoverSlideModel,
  type EventSlideModel,
} from "@/features/admin/lib/instagramSlides";

const BRAND = "#2B7FFF";
const INK = "#071120";
const SURFACE = "#F7F9FC";
const COVER_TINT = "rgba(7, 17, 32, 0.72)";
const WORDMARK = "wat2do.io";

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

const slideFrame: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: SLIDE_WIDTH,
  height: SLIDE_HEIGHT,
  backgroundColor: SURFACE,
  fontFamily: "Inter",
  color: INK,
  position: "relative",
};

const CARD_INSET = 60;
const CARD_WIDTH = SLIDE_WIDTH - CARD_INSET * 2;
const CARD_IMAGE_HEIGHT = 840;

/**
 * One event, rendered as the app's event card in dark mode.
 *
 * Same anatomy as EventCard: poster with the category chip top-left and the
 * organization badge bottom-left, then a surface body holding the title, the
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

          <div
            style={{
              display: "flex",
              position: "absolute",
              top: 28,
              left: 28,
              backgroundColor: model.category.color,
              color: DARK.categoryInk,
              borderRadius: 20,
              padding: "10px 22px",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {model.category.label}
          </div>

          <div
            style={{
              display: "flex",
              position: "absolute",
              bottom: 28,
              left: 28,
              maxWidth: CARD_WIDTH - 56,
              backgroundColor: DARK.background,
              border: `2px solid ${DARK.foreground}`,
              color: DARK.foreground,
              borderRadius: 20,
              padding: "10px 22px",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {model.organizationLine}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "36px 40px 40px 40px" }}>
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 600,
              lineHeight: 1.1,
              maxHeight: 130,
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
              marginTop: 30,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", color: DARK.mutedForeground }}>
              <div style={{ display: "flex", fontSize: 32 }}>{model.dateLine}</div>
              {model.timeLine ? (
                <div style={{ display: "flex", marginTop: 8, fontSize: 32 }}>{model.timeLine}</div>
              ) : null}
              <div style={{ display: "flex", marginTop: 8, fontSize: 32 }}>{model.location}</div>
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
                      fontSize: 26,
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

export function CoverSlideTemplate({ model }: { model: CoverSlideModel }) {
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(model.tiles.length || 1))));
  const rows = Math.max(1, Math.ceil((model.tiles.length || 1) / columns));
  const tileWidth = Math.ceil(SLIDE_WIDTH / columns);
  const tileHeight = Math.ceil(SLIDE_HEIGHT / rows);

  return (
    <div style={{ ...slideFrame, backgroundColor: BRAND }}>
      <div style={{ display: "flex", flexWrap: "wrap", width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
        {model.tiles.map((tile, index) => (
          <img
            key={`${tile}-${index}`}
            src={tile}
            width={tileWidth}
            height={tileHeight}
            style={{ width: tileWidth, height: tileHeight, objectFit: "cover" }}
            alt=""
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          backgroundColor: "rgba(7, 17, 32, 0.3)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 54,
          top: 820,
          width: SLIDE_WIDTH - 108,
          height: SLIDE_HEIGHT - 888,
          backgroundColor: COVER_TINT,
          border: `6px solid ${BRAND}`,
          borderRadius: 34,
          padding: "56px 46px",
        }}
      >
        <div style={{ display: "flex", fontSize: 48, fontWeight: 700, color: BRAND, letterSpacing: 1 }}>
          {model.headline}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 18,
            fontSize: 69,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "white",
            maxHeight: 160,
            overflow: "hidden",
          }}
        >
          {model.schoolName}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 31, color: "#D7E5FF" }}>
          {model.body}
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 34, fontWeight: 700, color: "white" }}>
          {WORDMARK}
        </div>
      </div>
    </div>
  );
}
