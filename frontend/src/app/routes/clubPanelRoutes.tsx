/**
 * Club Panel Routes Configuration
 * Centralized club panel route handlers and props
 */

import React, { useMemo } from "react";
import { AdminProvider } from "@/features/admin";
import { ClubPanel, ClubPanelPostersPage, ClubPanelIntegrationsPage, ClubPanelMembersPage } from "@/features/club-panel";
import type { Event, EventFormData } from "@/shared/types";
import { useNavigate } from "react-router-dom";
import { ROUTES, CLUB_PANEL_ROUTE_MAP } from "@/shared/constants/routes";

interface ClubPanelRoutesConfig {
  events: Event[];
  onEditEvent: (event: Event) => void;
  onDeleteEvent: (eventId: number) => Promise<void>;
  onCreateEvent: () => void;
  onAddEvent: (eventData: EventFormData) => Promise<number>;
  userEmail: string | null;
}

/**
 * Club panel navigation handler
 */
export function useClubPanelNavigation() {
  const navigate = useNavigate();

  return useMemo(
    () => (page: string) => {
      navigate(CLUB_PANEL_ROUTE_MAP[page] || ROUTES.CLUB_PANEL);
    },
    [navigate]
  );
}

/**
 * Club Panel Route Component
 */
export function ClubPanelRoute({ config }: { config: ClubPanelRoutesConfig }) {
  const handleNavigate = useClubPanelNavigation();

  return <ClubPanel onNavigate={handleNavigate} />;
}

/**
 * Club Panel Posters Route Component
 */
export function ClubPanelPostersRoute({ config }: { config: ClubPanelRoutesConfig }) {
  const navigate = useNavigate();

  const adminProps = useMemo(
    () => ({
      events: config.events,
      onBack: () => navigate(ROUTES.CLUB_PANEL),
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
