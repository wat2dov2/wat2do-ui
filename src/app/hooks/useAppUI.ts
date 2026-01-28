import { useState, useEffect, useCallback } from "react";
import type { ViewMode, FilterViewMode } from "@/shared/types";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { getSession, login, logout } from "@/features/auth";

/**
 * Hook for managing UI state in the App component
 * Handles modals, sidebar, command palette, view modes, and user profile
 */
export function useAppUI() {
  const { isDarkMode } = useDarkMode();

  // View modes
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filterViewMode, setFilterViewMode] = useState<FilterViewMode>("visual");

  // Sidebar state
  const [eventsExpanded, setEventsExpanded] = useState(true);

  // School dropdown state
  const [selectedSchool, setSelectedSchool] = useState("University of Waterloo");

  // Onboarding modal state
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Submit event modal state
  const [showSubmitEvent, setShowSubmitEvent] = useState(false);

  // Command palette state
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Profile/onboarding completion state
  const [profileCompleted, setProfileCompleted] = useState(false);

  // User email state (persisted via auth API)
  const [userEmail, setUserEmail] = useState<string | null>(() => {
    const session = getSession();
    return session.email;
  });

  // Persist email via auth API
  useEffect(() => {
    if (userEmail) {
      login(userEmail);
    } else {
      logout();
    }
  }, [userEmail]);

  // Command+K keyboard shortcut
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

  // Admin check - everyone is admin by default for now
  const isAdmin = true;

  return {
    // View modes
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,

    // Sidebar
    eventsExpanded,
    setEventsExpanded,

    // School
    selectedSchool,
    setSelectedSchool,

    // Modals
    showOnboarding,
    setShowOnboarding,
    showSubmitEvent,
    setShowSubmitEvent,

    // Command palette
    showCommandPalette,
    setShowCommandPalette,

    // Profile
    profileCompleted,
    setProfileCompleted,
    userEmail,
    setUserEmail,

    // Dark mode
    isDarkMode,

    // Admin
    isAdmin,
  };
}
