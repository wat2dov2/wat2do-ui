import { createContext, useContext, useState, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { PageMode, ViewMode, FilterViewMode } from "@/shared/types";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { ROUTES } from "@/shared/constants/routes";

interface UIContextValue {
  pageMode: PageMode;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  filterViewMode: FilterViewMode;
  setFilterViewMode: (mode: FilterViewMode) => void;
  eventsExpanded: boolean;
  setEventsExpanded: (expanded: boolean) => void;
  selectedSchool: string;
  setSelectedSchool: (school: string) => void;
  isDarkMode: boolean;
}

const UIContext = createContext<UIContextValue | undefined>(undefined);

interface UIProviderProps {
  children: ReactNode;
}

export function UIProvider({ children }: UIProviderProps) {
  const location = useLocation();
  const { isDarkMode } = useDarkMode();

  const [viewMode, setViewModeRaw] = useState<ViewMode>("grid");
  const [filterViewMode, setFilterViewModeRaw] = useState<FilterViewMode>("visual");
  const [eventsExpanded, setEventsExpandedRaw] = useState(true);
  const [selectedSchool, setSelectedSchoolRaw] = useState(DEFAULT_SCHOOL);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
  }, []);

  const setFilterViewMode = useCallback((mode: FilterViewMode) => {
    setFilterViewModeRaw(mode);
  }, []);

  const setEventsExpanded = useCallback((expanded: boolean) => {
    setEventsExpandedRaw(expanded);
  }, []);

  const setSelectedSchool = useCallback((school: string) => {
    setSelectedSchoolRaw(school);
  }, []);

  // Derive pageMode from current route
  const pageMode: PageMode = useMemo(() => {
    const currentPath = location.pathname;
    if (currentPath === ROUTES.CLUBS) return "clubs";
    if (currentPath === ROUTES.ABOUT) return "about";
    if (currentPath === ROUTES.SETTINGS) return "settings";
    if (currentPath.startsWith(ROUTES.ADMIN_EVENTS)) return "admin-events";
    if (currentPath.startsWith(ROUTES.ADMIN_CLUBS)) return "admin-clubs";
    if (currentPath.startsWith(ROUTES.ADMIN_SUBMISSIONS)) return "admin-submissions";
    if (currentPath.startsWith(ROUTES.ADMIN_POSTERS)) return "admin-posters";
    if (currentPath.startsWith(ROUTES.ADMIN)) return "admin";
    if (currentPath === ROUTES.MARKETING) return "marketing";
    return "events";
  }, [location.pathname]);

  const value = useMemo<UIContextValue>(() => ({
    pageMode,
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,
    eventsExpanded,
    setEventsExpanded,
    selectedSchool,
    setSelectedSchool,
    isDarkMode,
  }), [
    pageMode, viewMode, setViewMode,
    filterViewMode, setFilterViewMode,
    eventsExpanded, setEventsExpanded,
    selectedSchool, setSelectedSchool,
    isDarkMode,
  ]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUIContext() {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error("useUIContext must be used within UIProvider");
  }
  return context;
}
