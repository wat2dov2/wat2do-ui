/**
 * Club Panel Routes Configuration
 * Centralized club panel route handlers and props
 */

import React, { useMemo } from "react";
import { AdminProvider } from "@/features/admin";
import { ClubPanel, ClubPanelPostersPage, ClubPanelIntegrationsPage, ClubPanelMembersPage } from "@/features/club-panel";
import type { Event, EventFormData } from "@/shared/types";
import { useNavigation } from "@/contexts/NavigationContext";

interface ClubPanelRoutesConfig {
  events: Event[];
  onEditEvent: (event: Event) => void;
  onDeleteEvent: (eventId: number) => Promise<void>;
  onCreateEvent: () => void;
  onAddEvent: (eventData: EventFormData) => Promise<number>;
  userEmail: string | null;
}

/**
 * Club panel route mapping for navigation
 */
// eslint-disable-next-line react-refresh/only-export-components
export const CLUB_PANEL_ROUTE_MAP: Record<string, string> = {
  "club-panel-posters": "/club-panel/posters",
  "club-panel-integrations": "/club-panel/integrations",
  "club-panel-members": "/club-panel/members",
};

/**
 * Club panel navigation handler
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useClubPanelNavigation() {
  const { navigate } = useNavigation();

  return useMemo(
    () => (page: string) => {
      navigate(CLUB_PANEL_ROUTE_MAP[page] || "/club-panel");
    },
    [navigate]
  );
}

/**
 * Club Panel Route Component
 */
export function ClubPanelRoute({ config }: { config: ClubPanelRoutesConfig }) {
  void config;
  const handleNavigate = useClubPanelNavigation();

  return <ClubPanel onNavigate={handleNavigate} />;
}

/**
 * Club Panel Posters Route Component
 */
export function ClubPanelPostersRoute({ config }: { config: ClubPanelRoutesConfig }) {
  const { navigate } = useNavigation();

  const adminProps = useMemo(
    () => ({
      events: config.events,
      onBack: () => navigate("/club-panel"),
      userEmail: config.userEmail || "",
    }),
    [config.events, config.userEmail, navigate]
  );

  return (
    <AdminProvider {...adminProps}>
      <ClubPanelPostersPage />
    </AdminProvider>
  );
}

/**
 * Club Panel Integrations Route Component
 */
export function ClubPanelIntegrationsRoute() {
  return <ClubPanelIntegrationsPage />;
}

/**
 * Club Panel Members Route Component
 */
export function ClubPanelMembersRoute() {
  return <ClubPanelMembersPage />;
}
