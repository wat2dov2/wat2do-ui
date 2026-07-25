/**
 * The carousel slide markup.
 *
 * These are the only components in the app written with inline style objects
 * instead of design-system primitives: they are rasterized by satori in
 * `/api/render-instagram-slide`, which supports flexbox and inline styles only.
 * Everything the admin screen wraps around them uses the normal primitives.
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
const MUTED = "#5B6678";
const COVER_TINT = "rgba(7, 17, 32, 0.72)";
const WORDMARK = "wat2do.io";

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

export function EventSlideTemplate({ model }: { model: EventSlideModel }) {
  return (
    <div style={slideFrame}>
      <div style={{ display: "flex", width: SLIDE_WIDTH, height: 710 }}>
        {model.imageSrc ? (
          <img
            src={model.imageSrc}
            width={SLIDE_WIDTH}
            height={710}
            style={{ width: SLIDE_WIDTH, height: 710, objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div style={{ display: "flex", width: SLIDE_WIDTH, height: 710, backgroundColor: BRAND }} />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1 }}>
        <div style={{ display: "flex", width: 18, backgroundColor: BRAND }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            padding: "52px 70px 0 52px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              backgroundColor: BRAND,
              color: "white",
              borderRadius: 18,
              padding: "12px 22px",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {model.category}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 34,
              fontSize: 54,
              fontWeight: 700,
              lineHeight: 1.15,
              maxHeight: 190,
              overflow: "hidden",
            }}
          >
            {model.title}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", paddingBottom: 40 }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{model.dateLine}</div>
            <div style={{ display: "flex", marginTop: 16, fontSize: 32, color: MUTED }}>
              {model.location}
            </div>
            <div style={{ display: "flex", marginTop: 12, fontSize: 30, color: MUTED }}>
              {model.organizationLine}
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 30, fontWeight: 700, color: BRAND }}>
              {WORDMARK}
            </div>
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
