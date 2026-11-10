"use client";

/**
 * Club panel route handlers.
 *
 * Heavy club-panel page components are lazy-loaded so they are split into a
 * separate chunk that only club managers ever download.
 */

import { lazy, Suspense, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useClubPanelSite } from "@/features/club-panel/hooks/useClubPanelSite";
import { CLUB_PANEL_ROUTE_MAP, type ClubPanelRouteKey } from "@/shared/constants/routes";
import { RouteLoading } from "@/app/routes/RouteLoading";
import { Container, type ContainerSize } from "@/shared/layout/container";
import { PAGE_SHELLS } from "@/shared/constants/pageShells";

const loadClubPanel = () => import("@/features/club-panel");

const ClubPanel = lazy(() => loadClubPanel().then((m) => ({ default: m.ClubPanel })));
const ClubPanelEventsPage = lazy(() => loadClubPanel().then((m) => ({ default: m.ClubPanelEventsPage })));
const ClubPanelPositionsPage = lazy(() => loadClubPanel().then((m) => ({ default: m.ClubPanelPositionsPage })));
const ClubPanelMembersPage = lazy(() => loadClubPanel().then((m) => ({ default: m.ClubPanelMembersPage })));
const ClubPanelEventTicketsPage = lazy(() =>
  loadClubPanel().then((m) => ({ default: m.ClubPanelEventTicketsPage }))
);
const ClubPanelDoorScannerPage = lazy(() =>
  loadClubPanel().then((m) => ({ default: m.ClubPanelDoorScannerPage }))
);
const ClubPanelTicketSettingsPage = lazy(() =>
  loadClubPanel().then((m) => ({ default: m.ClubPanelTicketSettingsPage }))
);
const ClubPanelPayoutsPage = lazy(() => loadClubPanel().then((m) => ({ default: m.ClubPanelPayoutsPage })));

/**
 * Starts downloading the club panel's pages while the visitor's session is
 * still being restored, so a page never waits on its code once sign-in is done.
 */
export function usePreloadClubPanel() {
  useEffect(() => {
    void loadClubPanel();
  }, []);
}

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
 * A page shows only on its club's school site; until it is there, and while
 * its code loads, it holds the route's one loading state.
 */
function ClubPanelSuspense({ children, size }: { children: ReactNode; size?: ContainerSize }) {
  const pathname = usePathname();
  const onClubSite = useClubPanelSite();
  return (
    <Container size={size ?? PAGE_SHELLS[pathname]?.container ?? "lg"}>
      {onClubSite ? <Suspense fallback={<RouteLoading />}>{children}</Suspense> : <RouteLoading />}
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

export function ClubPanelTicketSettingsRoute() {
  return (
    <ClubPanelSuspense size="md">
      <ClubPanelTicketSettingsPage />
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
