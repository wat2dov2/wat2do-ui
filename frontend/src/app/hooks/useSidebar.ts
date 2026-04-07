import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/contexts/AppContext";
import { ROUTES } from "@/shared/constants/routes";

/**
 * Hook for managing sidebar-related logic: navigation and translations
 * Simplified - removed style calculations (now handled by CSS)
 * Eliminated sidebarHovered dependency
 */
export function useSidebar() {
  const { setShowCommandPalette, setShowSubmitEvent } = useAppContext();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Navigation handlers
  const handleCommandPaletteClick = useCallback(() => {
    setShowCommandPalette?.(true);
  }, [setShowCommandPalette]);

  const handleClubsClick = useCallback(() => {
    navigate(ROUTES.CLUBS);
  }, [navigate]);

  const handleMissionClick = useCallback(() => {
    navigate(ROUTES.ABOUT);
  }, [navigate]);

  const handleSettingsClick = useCallback(() => {
    navigate(ROUTES.SETTINGS);
  }, [navigate]);

  const handleExploreClick = useCallback(() => {
    navigate(ROUTES.HOME);
  }, [navigate]);

  const handleCreateClick = useCallback(() => {
    setShowSubmitEvent?.(true);
  }, [setShowSubmitEvent]);

  // Translations
  const translations = useMemo(
    () => ({
      search: t("common.search"),
      events: t("navigation.events"),
      explore: t("navigation.explore"),
      create: t("navigation.create"),
      clubs: t("navigation.clubs"),
      mission: t("navigation.mission"),
      contact: t("navigation.contact"),
      settings: t("navigation.settings"),
    }),
    [t]
  );

  return {
    handleCommandPaletteClick,
    handleClubsClick,
    handleMissionClick,
    handleSettingsClick,
    handleExploreClick,
    handleCreateClick,
    translations,
  };
}
