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
import { CLUB_PANEL_ROUTE_MAP, type ClubPanelRouteKey } from "@/shared/constants/routes";
import { RouteLoading } from "@/app/routes/RouteLoading";

const ClubPanel = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanel }))
);
const ClubPanelEventsPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelEventsPage }))
);
const ClubPanelPositionsPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelPositionsPage }))
);
const ClubPanelMembersPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelMembersPage }))
);
const ClubPanelEventTicketsPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelEventTicketsPage }))
);
const ClubPanelDoorScannerPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelDoorScannerPage }))
);
const ClubPanelPayoutsPage = lazy(() =>
  import("@/features/club-panel").then((m) => ({ default: m.ClubPanelPayoutsPage }))
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
    <Suspense fallback={<RouteLoading />}>
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

export function ClubPanelEventsRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelEventsPage />
    </ClubPanelSuspense>
  );
}

export function ClubPanelPositionsRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelPositionsPage />
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

export function ClubPanelEventTicketsRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelEventTicketsPage />
    </ClubPanelSuspense>
  );
}

export function ClubPanelDoorScannerRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelDoorScannerPage />
    </ClubPanelSuspense>
  );
}

export function ClubPanelPayoutsRoute() {
  return (
    <ClubPanelSuspense>
      <ClubPanelPayoutsPage />
    </ClubPanelSuspense>
  );
}
