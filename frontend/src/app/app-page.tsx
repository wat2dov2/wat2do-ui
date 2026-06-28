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
import { useUserEmail } from "@/features/auth/hooks/useAuthState";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useSearchStore } from "@/features/search/store/search.store";
import { getRouteDocumentTitle } from "@/shared/constants/routes";
import type { Role } from "@/shared/constants/roles";
import { getHostnameSchoolStatus } from "@/shared/constants/schools";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Toaster } from "@/shared/ui/toaster";

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
  const events = useEventsStore((s) => s.events);
  const setSchoolFilter = useEventsStore((s) => s.setSchoolFilter);
  const setFilterStateFromURL = useSearchStore((s) => s.setFilterStateFromURL);

  const hostnameSchoolStatus = useMemo(() => {
    if (typeof window === "undefined" || skipSchoolCheck) {
      return { candidate: null, isKnownSchool: true };
    }
    return getHostnameSchoolStatus(window.location.hostname);
  }, [skipSchoolCheck]);

  useEffect(() => {
    document.title = getRouteDocumentTitle(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!ready || authFlow) return;
    useSavedEventsStore.getState().fetchSavedEvents();
    useSavedOrganizationsStore.getState().fetchSavedOrganizations();
    useCreditsStore.getState().fetchBalance();
    useCreditsStore.getState().fetchActivePromotedEventIds();
  }, [authFlow, ready, userEmail]);

  useAppNavigation({
    events,
    setFilterStateFromURL,
    setSchoolFilter,
  });

  if (!ready) {
    return null;
  }

  if (!hostnameSchoolStatus.isKnownSchool && hostnameSchoolStatus.candidate) {
    return <UnknownSchoolPage requestedSchool={hostnameSchoolStatus.candidate} />;
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
