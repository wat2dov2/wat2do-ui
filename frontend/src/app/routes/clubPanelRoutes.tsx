"use client";

/**
 * Club panel route handlers.
 *
 * Heavy club-panel page components are lazy-loaded so they are split into a
 * separate chunk that only club managers ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CLUB_PANEL_ROUTE_MAP, type ClubPanelRouteKey } from "@/shared/constants/routes";
import { RouteLoading } from "@/app/routes/RouteLoading";
import { Container, type ContainerSize } from "@/shared/layout/container";
import { PAGE_SHELLS } from "@/shared/constants/pageShells";

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

/**
 * Every page here sits in its shell's width (see PAGE_SHELLS), so no page
 * stretches across a wide screen. Routes without a shell pass their own size.
 */
function ClubPanelSuspense({ children, size }: { children: ReactNode; size?: ContainerSize }) {
  const pathname = usePathname();
  return (
    <Container size={size ?? PAGE_SHELLS[pathname]?.container ?? "lg"}>
      <Suspense fallback={<RouteLoading />}>
      {children}
      </Suspense>
    </Container>
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
    <ClubPanelSuspense size="md">
      <ClubPanelEventTicketsPage />
    </ClubPanelSuspense>
  );
}

export function ClubPanelDoorScannerRoute() {
  return (
    <ClubPanelSuspense size="md">
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
