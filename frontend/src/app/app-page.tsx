"use client";

import { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppLayout } from "@/app/AppLayout";
import { CommandPaletteHotkeys } from "@/app/CommandPaletteHotkeys";
import { ModalContainer } from "@/app/ModalContainer";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { UnknownSchoolPage } from "@/app/UnknownSchoolPage";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useAppReady } from "@/app/client-providers";
import { loadUserProfile } from "@/features/auth/api/userRepository";
import { useAuthState, useUserEmail } from "@/features/auth/hooks/useAuthState";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { getRouteDocumentTitle } from "@/shared/constants/routes";
import type { Role } from "@/shared/constants/roles";
import {
  ALL_SCHOOLS,
  DEFAULT_SCHOOL,
  getHostnameSchoolStatus,
  getSchoolOrigin,
  isAllSchools,
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
  const ready = useAppReady();
  const pathname = usePathname();
  const userEmail = useUserEmail();
  const { isAdmin } = useAuthState();
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
    document.title = getRouteDocumentTitle(pathname);
  }, [pathname]);

  // The all-schools origin is an admin lens over every school at once. Anyone
  // else belongs on their own school's origin, so send them there rather than
  // showing a feed they cannot have. Auth flows are exempt: signing in is how
  // an admin gets a session on this host in the first place.
  const bounceFromAllSchools =
    ready && !authFlow && !skipSchoolCheck && !isAdmin && isAllSchools(hostnameSchoolStatus.school);

  useEffect(() => {
    if (!bounceFromAllSchools) return;
    window.location.assign(getSchoolOrigin(loadUserProfile()?.school || DEFAULT_SCHOOL));
  }, [bounceFromAllSchools]);

  useEffect(() => {
    if (!ready || authFlow) return;
    useSavedOrganizationsStore.getState().fetchSavedOrganizations();
    useCreditsStore.getState().fetchBalance();
    useCreditsStore.getState().fetchActivePromotedEventIds();
  }, [authFlow, ready, userEmail]);

  useAppNavigation({
    events,
    setSchoolFilter,
  });

  if (!ready) {
    return null;
  }

  const needsSchoolValidation =
    !skipSchoolCheck &&
    hostnameSchoolStatus.candidate !== null &&
    hostnameSchoolStatus.school !== ALL_SCHOOLS;

  if (needsSchoolValidation && isSchoolDirectoryPending) {
    return <LoadingPage className="min-h-dvh" />;
  }

  if (
    needsSchoolValidation &&
    !isSchoolDirectoryError &&
    !schoolBySlug.has(hostnameSchoolStatus.school)
  ) {
    return <UnknownSchoolPage requestedSchool={hostnameSchoolStatus.candidate} />;
  }

  if (bounceFromAllSchools) {
    return <LoadingPage className="min-h-dvh" />;
  }

  const protectedContent = requiresAuth || requiredRole ? (
    <ProtectedRoute requiredRole={requiredRole}>{children}</ProtectedRoute>
  ) : (
    children
  );

  const content = (
    <>
      <CommandPaletteHotkeys />
      <ModalContainer />
      <Toaster />
      <Suspense
        fallback={
          <div className="flex min-h-[400px] items-center justify-center">
            <LoadingPage className="min-h-[400px]" />
          </div>
        }
      >
        {chrome ? <AppLayout>{protectedContent}</AppLayout> : protectedContent}
      </Suspense>
    </>
  );

  return content;
}
