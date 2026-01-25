import { useState, useEffect, useCallback } from "react";
import { loadDarkMode, saveDarkMode } from "@/repositories/userRepository";

/**
 * Custom hook for managing dark mode
 */
export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = loadDarkMode();
    if (saved !== null) {
      return saved;
    }
    // Check system preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Apply dark mode class to document (initial load only)
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    saveDarkMode(isDarkMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Sync isDarkMode state when theme changes externally
  const handleThemeChange = useCallback((isDark: boolean) => {
    setIsDarkMode(isDark);
    saveDarkMode(isDark);
  }, []);

  // Watch for theme changes via MutationObserver (for AnimatedThemeToggler)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      if (isDark !== isDarkMode) {
        setIsDarkMode(isDark);
        saveDarkMode(isDark);
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
