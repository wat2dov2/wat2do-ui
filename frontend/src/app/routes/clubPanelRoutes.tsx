/**
 * Club Panel Routes Configuration
 * Centralized club panel route handlers and props.
 *
 * Heavy club-panel page components are lazy-loaded so they are split into a
 * separate chunk that only club managers ever download.
 */

import React, { lazy, Suspense, useMemo } from "react";
import type { Event, EventFormData } from "@/shared/types";
import { useNavigate } from "react-router-dom";
import { ROUTES, CLUB_PANEL_ROUTE_MAP } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

// Lazy-loaded club-panel page components.
const ClubPanel = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanel }))
);
const ClubPanelPostersPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelPostersPage }))
);
const ClubPanelIntegrationsPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelIntegrationsPage }))
);
const ClubPanelMembersPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelMembersPage }))
);

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
function useClubPanelNavigation() {
  const navigate = useNavigate();

  return useMemo(
    () => (page: string) => {
      navigate(CLUB_PANEL_ROUTE_MAP[page] || ROUTES.CLUB_PANEL);
    },
    [navigate]
  );
}

/** Suspense wrapper for lazy-loaded club-panel pages. */
function ClubPanelSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

/**
 * Club Panel Route Component
 */
export function ClubPanelRoute({ config }: { config: ClubPanelRoutesConfig }) {
  const handleNavigate = useClubPanelNavigation();

  return (
    <ClubPanelSuspense>
      <ClubPanel onNavigate={handleNavigate} />
    </ClubPanelSuspense>
  );
}

/**
 * Club Panel Posters Route Component
 */
export function ClubPanelPostersRoute({ config }: { config: ClubPanelRoutesConfig }) {
  const navigate = useNavigate();

  const onBack = useMemo(() => () => navigate(ROUTES.CLUB_PANEL), [navigate]);

  return (
    <ClubPanelSuspense>
      <ClubPanelPostersPage
        events={config.events}
        onBack={onBack}
        userEmail={config.userEmail || ""}
      />
    </ClubPanelSuspense>
  );
}

/**
 * Club Panel Integrations Route Component
 */
export function ClubPanelIntegrationsRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelIntegrationsPage />
    </ClubPanelSuspense>
  );
}

/**
 * Club Panel Members Route Component
 */
export function ClubPanelMembersRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelMembersPage />
    </ClubPanelSuspense>
  );
}
