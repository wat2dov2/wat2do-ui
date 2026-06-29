import { useCallback, useEffect, useSyncExternalStore } from "react";
import { loadTheme, saveTheme } from "@/shared/services/preferencesStorage";

function getDarkModeSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getServerDarkModeSnapshot(): boolean {
  return false;
}

function subscribeToDarkMode(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onStoreChange);
  };
}

/**
 * Custom hook for managing dark mode
 */
export function useDarkMode() {
  const isDarkMode = useSyncExternalStore(
    subscribeToDarkMode,
    getDarkModeSnapshot,
    getServerDarkModeSnapshot,
  );

  // Align stored preference + DOM class on first client mount.
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

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("no-transitions");
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleThemeChange = useCallback((isDark: boolean) => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    saveTheme(isDark ? "dark" : "light");
  }, []);

  return {
    isDarkMode,
    handleThemeChange,
  };
}
