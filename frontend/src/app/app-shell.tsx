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
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { getRouteDocumentTitle, ROUTES } from "@/shared/constants/routes";
import {
  DEFAULT_SCHOOL,
  getHostnameSchoolStatus,
  type HostnameSchoolStatus,
} from "@/shared/constants/schools";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
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
    pathname === ROUTES.EVENTS ||
    pathname === ROUTES.LOGIN ||
    pathname === ROUTES.ABOUT ||
    pathname === ROUTES.SUPPORT_LOCAL ||
    pathname === ROUTES.CLUBS ||
    pathname === ROUTES.POSITIONS ||
    pathname === ROUTES.PROMOTE ||
    /^\/events\/\d+\/?$/.test(pathname) ||
    /^\/clubs\/\d+\/?$/.test(pathname)
  );
}

/** Query-string effects suspend independently of the visible app shell. */
function AppNavigation() {
  const setSchoolFilter = useEventsStore((state) => state.setSchoolFilter);
  useAppNavigation({ setSchoolFilter });
  return null;
}

/**
 * Persistent client shell for every route.
 * Root layout keeps chrome and subscriptions mounted across navigation.
 * Route pages own only their server data and feature content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const authReady = useAuthReady();
  const pathname = usePathname();
  const userEmail = useUserEmail();
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
  }, [authReady, isAuthFlow, userEmail]);

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
      <Suspense fallback={null}>
        <AppNavigation />
      </Suspense>
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
