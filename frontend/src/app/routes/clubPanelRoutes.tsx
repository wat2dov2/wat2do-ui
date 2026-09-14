"use client";

/**
 * Club panel route handlers.
 *
 * Heavy club-panel page components are lazy-loaded so they are split into a
 * separate chunk that only club managers ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, CLUB_PANEL_ROUTE_MAP, type ClubPanelRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

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

function useClubPanelNavigation() {
  const router = useRouter();

  return useCallback(
    (page: ClubPanelRouteKey) => {
      router.push(CLUB_PANEL_ROUTE_MAP[page]);
    },
    [router]
  );
}

function ClubPanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

export function ClubPanelRoute() {
  const handleNavigate = useClubPanelNavigation();

  return (
    <ClubPanelSuspense>
      <ClubPanel onNavigate={handleNavigate} />
    </ClubPanelSuspense>
  );
}

export function ClubPanelPostersRoute() {
  const router = useRouter();

  const onBack = useCallback(() => router.push(ROUTES.CLUB_PANEL), [router]);

  return (
    <ClubPanelSuspense>
      <ClubPanelPostersPage
        onBack={onBack}
      />
    </ClubPanelSuspense>
  );
}

export function ClubPanelIntegrationsRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelIntegrationsPage />
    </ClubPanelSuspense>
  );
}

export function ClubPanelMembersRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelMembersPage />
    </ClubPanelSuspense>
  );
}
