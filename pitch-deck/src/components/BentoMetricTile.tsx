import React from "react";
import { BentoTile } from "./BentoTile";

type Tone = "light" | "surface" | "primary" | "dark";

interface BentoMetricTileProps {
  value: React.ReactNode;
  label: React.ReactNode;
  estimate?: boolean;
  tone?: Tone;
  colSpan?: number;
}

export const BentoMetricTile: React.FC<BentoMetricTileProps> = ({
  value,
  label,
  estimate = false,
  tone = "surface",
  colSpan = 1,
}) => {
  const valueColor =
    tone === "primary" || tone === "dark"
      ? "#fff"
      : estimate
        ? "var(--blue-600)"
        : "var(--brand-primary)";

  const labelColor =
    tone === "primary"
      ? "rgba(255,255,255,0.9)"
      : tone === "dark"
        ? "rgba(255,255,255,0.78)"
        : "var(--text-700)";

  return (
    <BentoTile
      tone={tone}
      colSpan={colSpan}
      style={{
        padding: "16px 18px",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: "clamp(26px, 2.6vw, 38px)",
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: valueColor,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: labelColor }}>{label}</div>
    </BentoTile>
  );
};
