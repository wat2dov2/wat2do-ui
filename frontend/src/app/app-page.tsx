"use client";

import { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppLayout } from "@/app/AppLayout";
import { CommandPaletteHotkeys } from "@/app/CommandPaletteHotkeys";
import { ModalContainer } from "@/app/ModalContainer";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { UnknownSchoolPage } from "@/app/UnknownSchoolPage";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useAuthReady } from "@/app/client-providers";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { getRouteDocumentTitle, ROUTES } from "@/shared/constants/routes";
import type { Role } from "@/shared/constants/roles";
import {
  DEFAULT_SCHOOL,
  getHostnameSchoolStatus,
  type HostnameSchoolStatus,
} from "@/shared/constants/schools";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Toaster } from "@/shared/ui/sonner";

interface AppPageProps {
  children: ReactNode;
  authFlow?: boolean;
  chrome?: boolean;
  requiresAuth?: boolean;
  requiredRole?: Role;
  skipSchoolCheck?: boolean;
}

interface AppPageContentProps extends AppPageProps {
  authFlow: boolean;
  chrome: boolean;
  requiresAuth: boolean;
  skipSchoolCheck: boolean;
}

function routeOwnsServerMetadata(pathname: string): boolean {
  return (
    pathname === ROUTES.HOME ||
    pathname === ROUTES.LOGIN ||
    pathname === ROUTES.CONTACT ||
    pathname === ROUTES.ORGANIZATIONS ||
    /^\/events\/\d+\/?$/.test(pathname) ||
    /^\/organizations\/\d+\/?$/.test(pathname)
  );
}

export function AppPage({
  children,
  authFlow = false,
  chrome = true,
  requiresAuth = false,
  requiredRole,
  skipSchoolCheck = false,
}: AppPageProps) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-dvh" />}>
      <AppPageContent
        authFlow={authFlow}
        chrome={chrome}
        requiresAuth={requiresAuth}
        requiredRole={requiredRole}
        skipSchoolCheck={skipSchoolCheck}
      >
        {children}
      </AppPageContent>
    </Suspense>
  );
}

function AppPageContent({
  children,
  authFlow,
  chrome,
  requiresAuth,
  requiredRole,
  skipSchoolCheck,
}: AppPageContentProps) {
  const authReady = useAuthReady();
  const pathname = usePathname();
  const userEmail = useUserEmail();
  const events = useEventsStore((s) => s.events);
  const setSchoolFilter = useEventsStore((s) => s.setSchoolFilter);
  const {
    schoolBySlug,
    isPending: isSchoolDirectoryPending,
    isError: isSchoolDirectoryError,
  } = useSchoolDirectory();

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

  // These read the signed-in account, so they wait on the auth bootstrap - not
  // on the language load, which is all `ready` ever meant.
  useEffect(() => {
    if (!authReady || authFlow) return;
    useSavedOrganizationsStore.getState().fetchSavedOrganizations();
    useCreditsStore.getState().fetchBalance();
    useCreditsStore.getState().fetchActivePromotedEventIds();
  }, [authFlow, authReady, userEmail]);

  useAppNavigation({
    events,
    setSchoolFilter,
  });

  const needsSchoolValidation =
    !skipSchoolCheck &&
    hostnameSchoolStatus.candidate !== null;

  // Only reject a subdomain once the directory can actually answer. While the
  // query is pending `schoolBySlug` is empty, so asking it then says "unknown"
  // about every school - the page would paint, flip to the unknown-school
  // screen, and flip back a round trip later. Waiting costs nothing: the
  // subdomain is either real, in which case this never fires, or it is not, in
  // which case the visitor sees the message a moment later.
  if (
    needsSchoolValidation &&
    !isSchoolDirectoryPending &&
    !isSchoolDirectoryError &&
    !schoolBySlug.has(hostnameSchoolStatus.school)
  ) {
    return <UnknownSchoolPage requestedSchool={hostnameSchoolStatus.candidate} />;
  }

  const protectedContent = requiresAuth || requiredRole ? (
    <ProtectedRoute requiredRole={requiredRole}>{children}</ProtectedRoute>
  ) : (
    children
  );

  const page = (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <LoadingPage className="min-h-[400px]" />
        </div>
      }
    >
      {chrome ? <AppLayout>{protectedContent}</AppLayout> : protectedContent}
    </Suspense>
  );

  return (
    <>
      {page}
      <CommandPaletteHotkeys />
      <ModalContainer />
      <Toaster />
    </>
  );
}
