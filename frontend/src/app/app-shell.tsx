"use client";

import { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppLayout } from "@/app/AppLayout";
import { CommandPaletteHotkeys } from "@/app/CommandPaletteHotkeys";
import { ModalContainer } from "@/app/ModalContainer";
import { UnknownSchoolPage } from "@/app/UnknownSchoolPage";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useAuthReady } from "@/app/client-providers";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { getRouteDocumentTitle, ROUTES } from "@/shared/constants/routes";
import {
  DEFAULT_SCHOOL,
  getHostnameSchoolStatus,
  type HostnameSchoolStatus,
} from "@/shared/constants/schools";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Toaster } from "@/shared/ui/sonner";

const CHROMELESS_ROUTES = new Set<string>([
  ROUTES.LOGIN,
  ROUTES.AUTH_CALLBACK,
  ROUTES.ONBOARDING,
  ROUTES.ONBOARDING_DEMO,
  "/design-system",
]);

const AUTH_FLOW_ROUTES = new Set<string>([
  ROUTES.LOGIN,
  ROUTES.AUTH_CALLBACK,
  ROUTES.ONBOARDING,
  ROUTES.ONBOARDING_DEMO,
]);

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function routeUsesChrome(pathname: string): boolean {
  return !(
    CHROMELESS_ROUTES.has(pathname) ||
    routeMatches(pathname, ROUTES.INVITE) ||
    routeMatches(pathname, "/qr")
  );
}

function routeOwnsServerMetadata(pathname: string): boolean {
  return (
    pathname === ROUTES.HOME ||
    pathname === ROUTES.LOGIN ||
    pathname === ROUTES.CONTACT ||
    pathname === ROUTES.CLUBS ||
    pathname === ROUTES.POSITIONS ||
    pathname === ROUTES.PROMOTE ||
    /^\/events\/\d+\/?$/.test(pathname) ||
    /^\/clubs\/\d+\/?$/.test(pathname)
  );
}

/**
 * Persistent client shell for every route.
 *
 * Root layout owns this component, so the app chrome, global subscriptions,
 * and account preloads survive client navigation. Route pages own only their
 * server data and feature content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-dvh" />}>
      <AppShellContent>{children}</AppShellContent>
    </Suspense>
  );
}

function AppShellContent({ children }: { children: ReactNode }) {
  const authReady = useAuthReady();
  const pathname = usePathname();
  const userEmail = useUserEmail();
  const setSchoolFilter = useEventsStore((state) => state.setSchoolFilter);
  const {
    schoolBySlug,
    isPending: isSchoolDirectoryPending,
    isError: isSchoolDirectoryError,
  } = useSchoolDirectory();
  const isAuthFlow = AUTH_FLOW_ROUTES.has(pathname);
  const skipSchoolCheck = routeMatches(pathname, "/qr");

  const hostnameSchoolStatus = useMemo<HostnameSchoolStatus>(() => {
    if (typeof window === "undefined" || skipSchoolCheck) {
      return { school: DEFAULT_SCHOOL, candidate: null };
    }
    return getHostnameSchoolStatus(window.location.hostname);
  }, [skipSchoolCheck]);

  useEffect(() => {
    if (routeOwnsServerMetadata(pathname)) return;
    document.title = getRouteDocumentTitle(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!authReady || isAuthFlow) return;
    void useSavedClubsStore.getState().fetchSavedClubs();
    void useCreditsStore.getState().fetchBalance();
    void useCreditsStore.getState().fetchActivePromotedEventIds();
  }, [authReady, isAuthFlow, userEmail]);

  useAppNavigation({ setSchoolFilter });

  const needsSchoolValidation =
    !skipSchoolCheck && hostnameSchoolStatus.candidate !== null;
  if (
    needsSchoolValidation &&
    !isSchoolDirectoryPending &&
    !isSchoolDirectoryError &&
    !schoolBySlug.has(hostnameSchoolStatus.school)
  ) {
    return <UnknownSchoolPage requestedSchool={hostnameSchoolStatus.candidate} />;
  }

  return (
    <>
      {routeUsesChrome(pathname) ? (
        <AppLayout>{children}</AppLayout>
      ) : (
        children
      )}
      <CommandPaletteHotkeys />
      <ModalContainer />
      <Toaster />
    </>
  );
}
