import { useCallback } from "react";
import confetti from "canvas-confetti";

interface ConfettiConfig {
  particleCount?: number;
  spread?: number;
  origin?: { x?: number; y?: number };
  colors?: string[];
  angle?: number;
}

interface UseConfettiReturn {
  trigger: (config?: ConfettiConfig) => void;
  triggerBurst: (count?: number) => void; // Multiple bursts for celebrations
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
    resolveColorToken("--accent", "rgb(217, 230, 241)"),
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

/**
 * Hook for triggering confetti celebrations
 * Provides consistent confetti behavior across the app
 */
export function useConfetti(): UseConfettiReturn {
  const trigger = useCallback((config?: ConfettiConfig) => {
    const colors = config?.colors ?? getThemeConfettiColors();
    confetti({
      ...defaultConfig,
      ...config,
      colors,
      origin: { ...defaultConfig.origin, ...config?.origin },
    });
  }, []);

  const triggerBurst = useCallback((count: number = 3) => {
    const end = Date.now() + 2 * 1000; // 2 seconds
    const colors = getThemeConfettiColors();

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  return { trigger, triggerBurst };
}
