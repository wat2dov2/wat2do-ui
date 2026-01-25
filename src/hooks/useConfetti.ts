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

const defaultConfig: Required<ConfettiConfig> = {
  particleCount: 80,
  spread: 70,
  origin: { y: 0.6 },
  colors: ["#3B82F6", "#60A5FA", "#10B981", "#F59E0B"],
  angle: 90,
};

/**
 * Hook for triggering confetti celebrations
 * Provides consistent confetti behavior across the app
 */
export function useConfetti(): UseConfettiReturn {
  const trigger = useCallback((config?: ConfettiConfig) => {
    confetti({
      ...defaultConfig,
      ...config,
      origin: { ...defaultConfig.origin, ...config?.origin },
    });
  }, []);

  const triggerBurst = useCallback((count: number = 3) => {
    const end = Date.now() + 2 * 1000; // 2 seconds

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors: ["#3B82F6", "#60A5FA", "#93C5FD", "#DBEAFE"],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors: ["#3B82F6", "#60A5FA", "#93C5FD", "#DBEAFE"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  return { trigger, triggerBurst };
}
