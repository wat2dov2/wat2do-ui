"use client";

import { useCallback, useRef, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { Button } from "@/shared/ui/button";
import { Moon, Sun } from "@/shared/ui/doodle-icons";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { isDarkMode, setDarkMode } = useDarkMode();
  const animatingRef = useRef(false);
  const label = isDarkMode
    ? t("navigation.switchToLightMode")
    : t("navigation.switchToDarkMode");

  const handleThemeChange = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    if (animatingRef.current) return;
    const { top, left, width, height } = event.currentTarget.getBoundingClientRect();
    // Pointer activations originate at the actual click; keyboard activation
    // has detail=0 and uses the control's center instead of viewport (0, 0).
    const x = event.detail > 0 ? event.clientX : left + width / 2;
    const y = event.detail > 0 ? event.clientY : top + height / 2;
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDarkMode(!isDarkMode);
      return;
    }

    const root = document.documentElement;
    animatingRef.current = true;
    root.classList.add("no-transitions");

    try {
      await document.startViewTransition(() => {
        flushSync(() => {
          setDarkMode(!isDarkMode);
        });
      }).ready;

      const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const animation = root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 400,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        },
      );
      await animation.finished;
    } finally {
      animatingRef.current = false;
      root.classList.remove("no-transitions");
    }
  }, [isDarkMode, setDarkMode]);

  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      aria-pressed={isDarkMode}
      onClick={handleThemeChange}
    >
      {isDarkMode ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
