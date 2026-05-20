import React from "react";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
  /** Overall opacity of the mosaic */
  opacity?: number;
  /** Optional tint overlay color (rgba) on top of the mosaic */
  overlay?: string;
  /** Layout style: "grid" (uniform tiles) or "scatter" (varied) */
  layout?: "grid" | "scatter";
}

const fallbackTiles = [
  "linear-gradient(135deg, #93c5fd 0%, #c7d2fe 100%)",
  "linear-gradient(135deg, #bfdbfe 0%, #e0e7ff 100%)",
  "linear-gradient(135deg, #dbeafe 0%, #fce7f3 100%)",
  "linear-gradient(135deg, #ddd6fe 0%, #bae6fd 100%)",
];

export const EventImageMosaic: React.FC<Props> = ({
  events,
  opacity = 0.28,
  overlay = "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.78) 100%)",
  layout = "grid",
}) => {
  const tiles = events.length > 0 ? events : [];

  if (layout === "scatter") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gridTemplateRows: "repeat(3, 1fr)",
            gap: 12,
            padding: 12,
          }}
        >
          {Array.from({ length: 15 }).map((_, i) => {
            const ev = tiles[i % Math.max(tiles.length, 1)];
            const rotate = (i % 2 === 0 ? -1 : 1) * (1.2 + (i % 3));
            return (
              <div
                key={i}
                style={{
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  transform: `rotate(${rotate}deg)`,
                  background:
                    fallbackTiles[i % fallbackTiles.length],
                  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                  animation: `drift ${6 + (i % 4)}s ease-in-out infinite`,
                  animationDelay: `${(i % 5) * 0.4}s`,
                }}
              >
                {ev && (
                  <img
                    src={ev.source_image_url}
                    alt=""
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", inset: 0, background: overlay }} />
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity,
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gridAutoRows: "1fr",
          gap: 8,
        }}
      >
        {Array.from({ length: 24 }).map((_, i) => {
          const ev = tiles[i % Math.max(tiles.length, 1)];
          return (
            <div
              key={i}
              style={{
                overflow: "hidden",
                background: fallbackTiles[i % fallbackTiles.length],
              }}
            >
              {ev && (
                <img
                  src={ev.source_image_url}
                  alt=""
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", inset: 0, background: overlay }} />
    </div>
  );
};
