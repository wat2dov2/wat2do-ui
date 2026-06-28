import React from "react";
import { BrandWave } from "./BrandWave";

type Variant = "gradient" | "light" | "dark";

interface SlideShellProps {
  variant?: Variant;
  kicker?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Optional background mosaic node (e.g. EventImageMosaic). */
  background?: React.ReactNode;
  /** Stripe-style soft gradient wave behind content. */
  wave?: boolean;
}

const variantBg: Record<Variant, React.CSSProperties> = {
  gradient: { background: "var(--grad-light)" },
  light: { background: "var(--bg)" },
  dark: { background: "var(--grad-dark)", color: "#fff" },
};

export const SlideShell: React.FC<SlideShellProps> = ({
  variant = "gradient",
  kicker,
  title,
  lede,
  children,
  footer,
  background,
  wave = false,
}) => {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        ...variantBg[variant],
        overflow: "hidden",
      }}
    >
      {wave && !background && (
        <BrandWave variant={variant === "dark" ? "dark" : "light"} />
      )}

      {background && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          {background}
        </div>
      )}

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          maxWidth: "var(--slide-max-width)",
          margin: "0 auto",
          padding: "32px 56px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          overflow: "hidden",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img
            src="/wat2do-logo.svg"
            alt="Wat2Do"
            style={{ width: 32, height: 32 }}
          />
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: variant === "dark" ? "rgba(255,255,255,0.78)" : "var(--text-500)",
              letterSpacing: "0.02em",
            }}
          >
            wat2do.io · campus pitch
          </span>
        </header>

        {kicker && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color:
                variant === "dark" ? "var(--blue-300)" : "var(--brand-primary)",
            }}
          >
            {kicker}
          </div>
        )}

        <h1
          style={{
            fontSize: "clamp(32px, 4.2vw, 56px)",
            maxWidth: "920px",
          }}
        >
          {title}
        </h1>

        {lede && (
          <p
            style={{
              fontSize: "clamp(15px, 1.3vw, 19px)",
              maxWidth: "780px",
              color:
                variant === "dark"
                  ? "rgba(255,255,255,0.82)"
                  : "var(--text-700)",
            }}
          >
            {lede}
          </p>
        )}

        <div
          data-slide-content
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            marginTop: 4,
            overflow: "hidden",
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              fontSize: 13,
              marginTop: "auto",
              color:
                variant === "dark"
                  ? "rgba(255,255,255,0.6)"
                  : "var(--text-500)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
