import { useState, useEffect, useCallback } from "react";
import { loadTheme, saveTheme } from "@/shared/services/preferencesStorage";

/**
 * Custom hook for managing dark mode
 */
export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const saved = loadTheme();
    if (saved !== null) {
      return saved === "dark";
    }
    // Check system preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Apply dark mode class to document (initial load only)
  useEffect(() => {
    const saved = loadTheme();
    const shouldBeDark = saved !== null
      ? saved === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    saveTheme(shouldBeDark ? "dark" : "light");
    requestAnimationFrame(() => {
      setIsDarkMode(shouldBeDark);
    });

    // Remove no-transitions class after mount so transitions work for manual toggling
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("no-transitions");
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []); // Only run on mount

  // Sync isDarkMode state when theme changes externally
  const handleThemeChange = useCallback((isDark: boolean) => {
    setIsDarkMode(isDark);
    saveTheme(isDark ? "dark" : "light");
  }, []);

  // Watch for theme changes via MutationObserver (for AnimatedThemeToggler)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      if (isDark !== isDarkMode) {
        setIsDarkMode(isDark);
        saveTheme(isDark ? "dark" : "light");
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [isDarkMode]);

  return {
    isDarkMode,
    handleThemeChange,
  };
}
