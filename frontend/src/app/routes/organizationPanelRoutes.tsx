/**
 * Club Panel Routes Configuration
 * Centralized club panel route handlers and props.
 *
 * Heavy club-panel page components are lazy-loaded so they are split into a
 * separate chunk that only club managers ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES, ORGANIZATION_PANEL_ROUTE_MAP, type OrganizationPanelRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

// Lazy-loaded club-panel page components.
const OrganizationPanel = lazy(() =>
  import("@/features/organization-panel").then((m) => ({ default: m.OrganizationPanel }))
);
const OrganizationPanelPostersPage = lazy(() =>
  import("@/features/organization-panel").then((m) => ({ default: m.OrganizationPanelPostersPage }))
);
const OrganizationPanelIntegrationsPage = lazy(() =>
  import("@/features/organization-panel").then((m) => ({ default: m.OrganizationPanelIntegrationsPage }))
);
const OrganizationPanelMembersPage = lazy(() =>
  import("@/features/organization-panel").then((m) => ({ default: m.OrganizationPanelMembersPage }))
);

/**
 * Club panel navigation handler
 */
function useOrganizationPanelNavigation() {
  const navigate = useNavigate();

  return useCallback(
    (page: OrganizationPanelRouteKey) => {
      navigate(ORGANIZATION_PANEL_ROUTE_MAP[page]);
    },
    [navigate]
  );
}

/** Suspense wrapper for lazy-loaded club-panel pages. */
function OrganizationPanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

/**
 * Club Panel Route Component
 */
export function OrganizationPanelRoute() {
  const handleNavigate = useOrganizationPanelNavigation();

  return (
    <OrganizationPanelSuspense>
      <OrganizationPanel onNavigate={handleNavigate} />
    </OrganizationPanelSuspense>
  );
}

/**
 * Club Panel Posters Route Component
 */
export function OrganizationPanelPostersRoute() {
  const navigate = useNavigate();

  const onBack = useCallback(() => navigate(ROUTES.ORGANIZATION_PANEL), [navigate]);

  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelPostersPage
        onBack={onBack}
      />
    </OrganizationPanelSuspense>
  );
}

/**
 * Club Panel Integrations Route Component
 */
export function OrganizationPanelIntegrationsRoute() {
  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelIntegrationsPage />
    </OrganizationPanelSuspense>
  );
}

/**
 * Club Panel Members Route Component
 */
export function OrganizationPanelMembersRoute() {
  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelMembersPage />
    </OrganizationPanelSuspense>
  );
}
