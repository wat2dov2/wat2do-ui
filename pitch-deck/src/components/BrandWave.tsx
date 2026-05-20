import React from "react";

interface Props {
  variant?: "light" | "dark";
}

export const BrandWave: React.FC<Props> = ({ variant = "light" }) => {
  const opacity = variant === "dark" ? 0.35 : 0.55;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        className="brand-wave"
        style={{
          position: "absolute",
          width: "140%",
          height: "62%",
          left: "-20%",
          top: "-8%",
          opacity,
          background:
            variant === "dark"
              ? "radial-gradient(ellipse at 30% 20%, rgba(4,136,254,0.45) 0%, transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(99,102,241,0.35) 0%, transparent 50%), linear-gradient(135deg, rgba(0,86,214,0.2) 0%, transparent 60%)"
              : "radial-gradient(ellipse at 25% 15%, rgba(4,136,254,0.42) 0%, transparent 58%), radial-gradient(ellipse at 75% 55%, rgba(99,102,241,0.28) 0%, transparent 52%), linear-gradient(135deg, rgba(0,86,214,0.14) 0%, transparent 62%)",
          filter: "blur(42px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: "120%",
          height: "48%",
          left: "-10%",
          bottom: "-18%",
          opacity: opacity * 0.85,
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(4,136,254,0.32) 0%, transparent 68%)",
          filter: "blur(36px)",
        }}
      />
    </div>
  );
};
