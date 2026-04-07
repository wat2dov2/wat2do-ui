import { useState, useEffect, useCallback } from "react";
import type { ViewMode, FilterViewMode } from "@/shared/types";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { getSession, isAuthenticated, isProfileCompleted } from "@/features/auth";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";

export function useAppUI() {
  const { isDarkMode } = useDarkMode();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filterViewMode, setFilterViewMode] = useState<FilterViewMode>("visual");
  const [eventsExpanded, setEventsExpanded] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState(DEFAULT_SCHOOL);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSubmitEvent, setShowSubmitEvent] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  const [profileCompleted, setProfileCompleted] = useState(() => isProfileCompleted());
  const [userEmail, setUserEmail] = useState<string | null>(() => getSession().email);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isAdmin = true;

  return {
    viewMode, setViewMode,
    filterViewMode, setFilterViewMode,
    eventsExpanded, setEventsExpanded,
    selectedSchool, setSelectedSchool,
    showOnboarding, setShowOnboarding,
    showSubmitEvent, setShowSubmitEvent,
    showCommandPalette, setShowCommandPalette,
    profileCompleted, setProfileCompleted,
    userEmail, setUserEmail,
    isDarkMode,
    isAdmin,
  };
}
