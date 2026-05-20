import React from "react";

interface CardProps {
  children: React.ReactNode;
  padding?: number | string;
  emphasis?: "default" | "primary";
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({
  children,
  padding = 24,
  emphasis = "default",
  style,
}) => {
  return (
    <div
      data-card
      style={{
        background:
          emphasis === "primary"
            ? "linear-gradient(135deg, #0056d6 0%, #0488fe 100%)"
            : "rgba(255, 255, 255, 0.92)",
        color: emphasis === "primary" ? "#fff" : "var(--text-900)",
        borderRadius: "var(--radius-lg)",
        padding,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border:
          emphasis === "primary"
            ? "1px solid rgba(255,255,255,0.18)"
            : "1px solid var(--border)",
        boxShadow: "var(--shadow-m)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};
