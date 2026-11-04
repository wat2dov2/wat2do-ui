/**
 * The link preview of a school's event feed.
 *
 * Like the carousel slide templates, this is written with inline style objects
 * instead of design-system primitives: `ImageResponse` rasterizes it with
 * satori, which supports flexbox and inline styles only, with no CSS variables.
 */

import type { SchoolShareCard } from "@/features/events/lib/schoolShareCard";
import { controlBox } from "@/shared/config/controlBox";

const { width: WIDTH, height: HEIGHT } = controlBox.socialPreviews;
const MARGIN = 72;

/*
 * The recoloured cover logo draws the Wat2Do wordmark centred in a 1080 square
 * filled with the school's primary colour, which is also the card's background,
 * so only the wordmark reads. Its ink spans x 195-885 and y 297-783 of that
 * square; the logo is placed by its ink, flush with the right margin and
 * centred vertically, and the padding around the ink simply runs off the card.
 */
const LOGO_SIZE = 600;
const LOGO_SCALE = LOGO_SIZE / 1080;
const LOGO_LEFT = Math.round(WIDTH - MARGIN - 885 * LOGO_SCALE);
const LOGO_TOP = Math.round(HEIGHT / 2 - ((297 + 783) / 2) * LOGO_SCALE);
const TEXT_WIDTH = Math.round(LOGO_LEFT + 195 * LOGO_SCALE - MARGIN * 2);

export function SchoolShareImage({
  card,
  logoSrc,
}: {
  card: SchoolShareCard;
  logoSrc: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: WIDTH,
        height: HEIGHT,
        overflow: "hidden",
        backgroundColor: card.colors.primary,
        color: card.colors.secondary,
        fontFamily: "Satoshi",
      }}
    >
      <img
        src={logoSrc}
        width={LOGO_SIZE}
        height={LOGO_SIZE}
        alt=""
        style={{
          position: "absolute",
          left: LOGO_LEFT,
          top: LOGO_TOP,
          width: LOGO_SIZE,
          height: LOGO_SIZE,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: TEXT_WIDTH,
          marginLeft: MARGIN,
          paddingTop: MARGIN,
          paddingBottom: MARGIN,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "block",
              lineClamp: 3,
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
            }}
          >
            {card.schoolName}
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 40, fontWeight: 500 }}>
            {card.eventsLine}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>
          {card.siteLine}
        </div>
      </div>
    </div>
  );
}
