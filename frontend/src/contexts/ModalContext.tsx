import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";

interface ModalContextValue {
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  showSubmitEvent: boolean;
  setShowSubmitEvent: (show: boolean) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
}

const ModalContext = createContext<ModalContextValue | undefined>(undefined);

interface ModalProviderProps {
  children: ReactNode;
}

export function ModalProvider({ children }: ModalProviderProps) {
  const [showOnboarding, setShowOnboardingRaw] = useState(false);
  const [showSubmitEvent, setShowSubmitEventRaw] = useState(false);
  const [showCommandPalette, setShowCommandPaletteRaw] = useState(false);

  const setShowOnboarding = useCallback((show: boolean) => {
    setShowOnboardingRaw(show);
  }, []);

  const setShowSubmitEvent = useCallback((show: boolean) => {
    setShowSubmitEventRaw(show);
  }, []);

  const setShowCommandPalette = useCallback((show: boolean) => {
    setShowCommandPaletteRaw(show);
  }, []);

  // Cmd+K / Ctrl+K keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPaletteRaw((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value = useMemo<ModalContextValue>(() => ({
    showOnboarding,
    setShowOnboarding,
    showSubmitEvent,
    setShowSubmitEvent,
    showCommandPalette,
    setShowCommandPalette,
  }), [
    showOnboarding, setShowOnboarding,
    showSubmitEvent, setShowSubmitEvent,
    showCommandPalette, setShowCommandPalette,
  ]);

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModalContext() {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error("useModalContext must be used within ModalProvider");
  }
  return context;
}
