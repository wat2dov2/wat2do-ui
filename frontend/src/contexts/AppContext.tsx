/**
 * App Context
 * Centralized state management for app-wide UI and navigation state
 * Eliminates prop drilling in AppLayout, Sidebar, and TopNav
 */

import React, { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { PageMode, ViewMode, FilterViewMode } from "@/shared/types";

interface AppContextValue {
  // Navigation
  pageMode: PageMode;
  
  // UI State
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  filterViewMode: FilterViewMode;
  setFilterViewMode: (mode: FilterViewMode) => void;
  
  // Sidebar
  eventsExpanded: boolean;
  setEventsExpanded: (expanded: boolean) => void;
  
  // School
  selectedSchool: string;
  setSelectedSchool: (school: string) => void;
  
  // Modals
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  showSubmitEvent: boolean;
  setShowSubmitEvent: (show: boolean) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
  
  // Profile
  profileCompleted: boolean;
  setProfileCompleted: (completed: boolean) => void;
  userEmail: string | null;
  setUserEmail: (email: string | null) => void;
  
  // Dark mode
  isDarkMode: boolean;
  
  // Admin
  isAdmin: boolean;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
  value: AppContextValue;
}

export function AppProvider({ children, value }: AppProviderProps) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return context;
}
