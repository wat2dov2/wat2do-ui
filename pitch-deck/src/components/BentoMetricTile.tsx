import React from "react";

type Tone = "light" | "surface" | "primary" | "dark";

interface BentoMetricTileProps {
  value: React.ReactNode;
  label: React.ReactNode;
  estimate?: boolean;
  tone?: Tone;
  colSpan?: number;
}

const toneStyles: Record<Tone, React.CSSProperties> = {
  light: {
    background: "var(--blue-50)",
    color: "var(--text-900)",
    border: "1px solid rgba(0, 86, 214, 0.08)",
  },
  surface: {
    background: "rgba(255, 255, 255, 0.94)",
    color: "var(--text-900)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-s)",
  },
  primary: {
    background: "linear-gradient(135deg, #0056d6 0%, #0488fe 100%)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.18)",
    boxShadow: "var(--shadow-m)",
  },
  dark: {
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.14)",
  },
};

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
    <div
      data-card
      style={{
        borderRadius: "var(--radius-lg)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minHeight: 0,
        gridColumn: colSpan > 1 ? `span ${colSpan}` : undefined,
        ...toneStyles[tone],
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
    </div>
  );
};
