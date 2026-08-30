import { useCallback, useSyncExternalStore } from "react";
import { saveTheme } from "@/shared/services/preferencesStorage";

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
  return () => observer.disconnect();
}

export function useDarkMode() {
  const isDarkMode = useSyncExternalStore(
    subscribeToDarkMode,
    getDarkModeSnapshot,
    getServerDarkModeSnapshot,
  );

  const setDarkMode = useCallback((nextIsDarkMode: boolean) => {
    document.documentElement.classList.toggle("dark", nextIsDarkMode);
    saveTheme(nextIsDarkMode ? "dark" : "light");
  }, []);

  return { isDarkMode, setDarkMode };
}
