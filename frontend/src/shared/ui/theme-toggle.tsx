"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { saveTheme } from "@/shared/services/preferencesStorage";
import { Button } from "@/shared/ui/button";
import { Moon, Sun } from "@/shared/ui/doodle-icons";

export function ThemeToggle() {
  const { t } = useTranslation();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = isDarkMode
    ? t("navigation.switchToLightMode")
    : t("navigation.switchToDarkMode");

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  const handleThemeChange = useCallback(async () => {
    if (!buttonRef.current) return;

    if (!document.startViewTransition) {
      const nextIsDarkMode = !isDarkMode;
      setIsDarkMode(nextIsDarkMode);
      document.documentElement.classList.toggle("dark");
      saveTheme(nextIsDarkMode ? "dark" : "light");
      return;
    }

    const root = document.documentElement;
    root.classList.add("no-transitions");

    try {
      await document.startViewTransition(() => {
        flushSync(() => {
          const nextIsDarkMode = !isDarkMode;
          setIsDarkMode(nextIsDarkMode);
          root.classList.toggle("dark");
          saveTheme(nextIsDarkMode ? "dark" : "light");
        });
      }).ready;

      const { top, left, width, height } =
        buttonRef.current.getBoundingClientRect();
      const x = left + width / 2;
      const y = top + height / 2;
      const maxRadius = Math.hypot(
        Math.max(left, window.innerWidth - left),
        Math.max(top, window.innerHeight - top),
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
      root.classList.remove("no-transitions");
    }
  }, [isDarkMode]);

  return (
    <Button
      ref={buttonRef}
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
