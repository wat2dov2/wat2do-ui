import React, { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ViewMode } from "@/shared/types";

interface CommandPaletteContextValue {
  profileCompleted: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  setShowFilterDropdown: (show: boolean) => void;
  setShowSubmitEvent: (show: boolean) => void;
  setShowOnboarding: (show: boolean) => void;
  onClearAllFilters: () => void;
  onSetFreeFilter: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: CommandPaletteContextValue;
}) {
  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  }
  return context;
}
