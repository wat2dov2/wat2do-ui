import React from "react";
import type { EventImage } from "../lib/types";

interface Props {
  event?: EventImage;
  caption?: string;
  rotate?: number;
  /**
   * When true, the card sizes itself to its parent (flex-aware).
   * When false, it falls back to a 4:5 aspect ratio image.
   */
  fill?: boolean;
}

const fallbackBg =
  "linear-gradient(135deg, #93c5fd 0%, #c7d2fe 60%, #ddd6fe 100%)";

export const EventCardPreview: React.FC<Props> = ({
  event,
  caption,
  rotate = 0,
  fill = true,
}) => {
  return (
    <div
      style={{
        position: "relative",
        background: "#fff",
        borderRadius: "var(--radius-md)",
        padding: 8,
        boxShadow: "var(--shadow-s)",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        width: "100%",
        height: fill ? "100%" : "auto",
        minHeight: 0,
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: fill ? 1 : "none",
          minHeight: 0,
          aspectRatio: fill ? undefined : "4 / 5",
          width: "100%",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
          background: fallbackBg,
        }}
      >
        {event && (
          <img
            src={event.source_image_url}
            alt={event.title}
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
      <div style={{ paddingInline: 4, flexShrink: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-900)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {caption ?? event?.title ?? "Wat2Do event"}
        </div>
        {event?.organization && (
          <div
            style={{
              fontSize: 10,
              color: "var(--text-500)",
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            @{event.organization}
          </div>
        )}
      </div>
    </div>
  );
};
