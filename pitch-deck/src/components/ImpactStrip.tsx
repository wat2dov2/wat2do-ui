import React from "react";

type Metric = {
  value: React.ReactNode;
  label: React.ReactNode;
  estimate?: boolean;
};

interface Props {
  metrics: readonly Metric[];
  variant?: "light" | "dark";
}

export const ImpactStrip: React.FC<Props> = ({ metrics, variant = "light" }) => {
  const isDark = variant === "dark";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
        gap: 0,
        borderRadius: "var(--radius-lg)",
        border: isDark
          ? "1px solid rgba(255,255,255,0.14)"
          : "1px solid var(--border)",
        background: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.88)",
        overflow: "hidden",
        boxShadow: isDark ? "none" : "var(--shadow-s)",
      }}
    >
      {metrics.map((metric, index) => (
        <div
          key={String(metric.label)}
          style={{
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            borderLeft:
              index === 0
                ? "none"
                : isDark
                  ? "1px solid rgba(255,255,255,0.12)"
                  : "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: "clamp(26px, 2.6vw, 38px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: metric.estimate
                ? isDark
                  ? "var(--blue-300)"
                  : "var(--blue-600)"
                : isDark
                  ? "#fff"
                  : "var(--brand-primary)",
            }}
          >
            {metric.value}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: isDark ? "rgba(255,255,255,0.72)" : "var(--text-700)",
            }}
          >
            {metric.label}
          </div>
        </div>
      ))}
    </div>
  );
};
