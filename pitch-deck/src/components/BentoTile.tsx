import React from "react";

type Tone = "light" | "surface" | "primary" | "dark";

interface BentoTileProps {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  body?: React.ReactNode;
  tone?: Tone;
  colSpan?: number;
  rowSpan?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
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

export const BentoTile: React.FC<BentoTileProps> = ({
  eyebrow,
  title,
  body,
  tone = "surface",
  colSpan = 1,
  rowSpan = 1,
  children,
  style,
}) => {
  const bodyColor =
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
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 0,
        overflow: "hidden",
        gridColumn: colSpan > 1 ? `span ${colSpan}` : undefined,
        gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined,
        ...toneStyles[tone],
        ...style,
      }}
    >
      {eyebrow && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color:
              tone === "primary" || tone === "dark"
                ? "rgba(255,255,255,0.78)"
                : "var(--brand-primary)",
          }}
        >
          {eyebrow}
        </div>
      )}
      {title && (
        <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>{title}</div>
      )}
      {body && (
        <div style={{ fontSize: 14, lineHeight: 1.5, color: bodyColor }}>{body}</div>
      )}
      {children}
    </div>
  );
};
