import React from "react";

interface ChipProps {
  children: React.ReactNode;
  tone?: "blue" | "neutral" | "live";
}

const styles: Record<NonNullable<ChipProps["tone"]>, React.CSSProperties> = {
  blue: {
    background: "var(--blue-50)",
    color: "var(--blue-700)",
    border: "1px solid rgba(0,86,214,0.18)",
  },
  neutral: {
    background: "#fff",
    color: "var(--text-700)",
    border: "1px solid var(--border-strong)",
  },
  live: {
    background: "rgba(239, 68, 68, 0.1)",
    color: "#b91c1c",
    border: "1px solid rgba(239, 68, 68, 0.32)",
  },
};

export const Chip: React.FC<ChipProps> = ({ children, tone = "blue" }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 12px",
      borderRadius: "var(--radius-pill)",
      fontSize: 13,
      fontWeight: 600,
      ...styles[tone],
    }}
  >
    {tone === "live" && (
      <span
        className="pulse-live"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--red-500)",
        }}
      />
    )}
    {children}
  </span>
);
