import { useCallback } from "react";

interface ConfettiConfig {
  particleCount?: number;
  spread?: number;
  origin?: { x?: number; y?: number };
  colors?: string[];
  angle?: number;
}

function resolveColorToken(token: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value || fallback;
}

function getThemeConfettiColors(): string[] {
  return [
    resolveColorToken("--primary", "rgb(0, 82, 255)"),
    resolveColorToken("--muted", "rgb(217, 230, 241)"),
    resolveColorToken("--success", "rgb(34, 197, 94)"),
    resolveColorToken("--warning", "rgb(245, 158, 11)"),
  ];
}

const defaultConfig: Omit<Required<ConfettiConfig>, "colors"> = {
  particleCount: 80,
  spread: 70,
  origin: { y: 0.6 },
  angle: 90,
};

/** The confetti drawer loads with the first celebration, never with the page. */
export function useConfetti() {
  const trigger = useCallback((config?: ConfettiConfig) => {
    const colors = config?.colors ?? getThemeConfettiColors();
    void import("canvas-confetti").then(({ default: confetti }) =>
      confetti({
        ...defaultConfig,
        ...config,
        colors,
        origin: { ...defaultConfig.origin, ...config?.origin },
      }),
    );
  }, []);

  return { trigger };
}
