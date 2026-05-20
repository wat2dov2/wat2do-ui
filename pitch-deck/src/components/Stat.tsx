import React from "react";

interface StatProps {
  value: React.ReactNode;
  label: React.ReactNode;
  source?: React.ReactNode;
  placeholder?: boolean;
  estimate?: boolean;
  compact?: boolean;
}

export const Stat: React.FC<StatProps> = ({
  value,
  label,
  source,
  placeholder = false,
  estimate = false,
  compact = false,
}) => {
  const muted = placeholder || estimate;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: compact ? "14px 16px" : "18px 20px",
        boxShadow: "var(--shadow-s)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: compact
            ? "clamp(24px, 2.2vw, 32px)"
            : "clamp(30px, 2.8vw, 40px)",
          fontWeight: 800,
          color: muted ? "var(--blue-600)" : "var(--brand-primary)",
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: compact ? 12 : 13, fontWeight: 600, color: "var(--text-700)" }}>
        {label}
      </div>
      {source && (
        <div style={{ fontSize: 11, color: "var(--text-500)" }}>{source}</div>
      )}
    </div>
  );
};
