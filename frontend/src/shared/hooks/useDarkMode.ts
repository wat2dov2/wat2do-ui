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

/** Turns every transition off (index.css); the first paint uses it too (app/layout.tsx). */
const NO_TRANSITIONS_CLASS = "no-transitions";
let restoreTransitionsFrame = 0;

/**
 * Switches the theme with transitions off. Every colour on the page changes at
 * once, so each element's own colour transition would otherwise fire together
 * and the page would smear through a blend of both themes. They come back two
 * frames later, once the new theme has been drawn.
 */
function switchTheme(nextIsDarkMode: boolean) {
  const root = document.documentElement;
  root.classList.add(NO_TRANSITIONS_CLASS);
  root.classList.toggle("dark", nextIsDarkMode);
  cancelAnimationFrame(restoreTransitionsFrame);
  restoreTransitionsFrame = requestAnimationFrame(() => {
    restoreTransitionsFrame = requestAnimationFrame(() => root.classList.remove(NO_TRANSITIONS_CLASS));
  });
}

export function useDarkMode() {
  const isDarkMode = useSyncExternalStore(
    subscribeToDarkMode,
    getDarkModeSnapshot,
    getServerDarkModeSnapshot,
  );

  const setDarkMode = useCallback((nextIsDarkMode: boolean) => {
    switchTheme(nextIsDarkMode);
    saveTheme(nextIsDarkMode ? "dark" : "light");
  }, []);

  return { isDarkMode, setDarkMode };
}
