/**
 * Organization Panel Routes Configuration
 * Centralized organization panel route handlers and props.
 *
 * Heavy organization-panel page components are lazy-loaded so they are split into a
 * separate chunk that only organization managers ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, ORGANIZATION_PANEL_ROUTE_MAP, type OrganizationPanelRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

// Lazy-loaded organization-panel page components.
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
 * Organization panel navigation handler
 */
function useOrganizationPanelNavigation() {
  const router = useRouter();

  return useCallback(
    (page: OrganizationPanelRouteKey) => {
      router.push(ORGANIZATION_PANEL_ROUTE_MAP[page]);
    },
    [router]
  );
}

/** Suspense wrapper for lazy-loaded organization-panel pages. */
function OrganizationPanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

/**
 * Organization Panel Route Component
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
 * Organization Panel Posters Route Component
 */
export function OrganizationPanelPostersRoute() {
  const router = useRouter();

  const onBack = useCallback(() => router.push(ROUTES.ORGANIZATION_PANEL), [router]);

  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelPostersPage
        onBack={onBack}
      />
    </OrganizationPanelSuspense>
  );
}

/**
 * Organization Panel Integrations Route Component
 */
export function OrganizationPanelIntegrationsRoute() {
  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelIntegrationsPage />
    </OrganizationPanelSuspense>
  );
}

/**
 * Organization Panel Members Route Component
 */
export function OrganizationPanelMembersRoute() {
  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelMembersPage />
    </OrganizationPanelSuspense>
  );
}
