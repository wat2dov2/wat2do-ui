"use client";

/**
 * Organization panel route handlers.
 *
 * Heavy organization-panel page components are lazy-loaded so they are split into a
 * separate chunk that only organization managers ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, ORGANIZATION_PANEL_ROUTE_MAP, type OrganizationPanelRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

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

function useOrganizationPanelNavigation() {
  const router = useRouter();

  return useCallback(
    (page: OrganizationPanelRouteKey) => {
      router.push(ORGANIZATION_PANEL_ROUTE_MAP[page]);
    },
    [router]
  );
}

function OrganizationPanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

export function OrganizationPanelRoute() {
  const handleNavigate = useOrganizationPanelNavigation();

  return (
    <OrganizationPanelSuspense>
      <OrganizationPanel onNavigate={handleNavigate} />
    </OrganizationPanelSuspense>
  );
}

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

export function OrganizationPanelIntegrationsRoute() {
  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelIntegrationsPage />
    </OrganizationPanelSuspense>
  );
}

export function OrganizationPanelMembersRoute() {
  return (
    <OrganizationPanelSuspense>
      <OrganizationPanelMembersPage />
    </OrganizationPanelSuspense>
  );
}
