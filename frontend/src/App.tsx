import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { LazyMotion, domMax } from "framer-motion";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { LoadingPage } from "@/shared/ui/loading-page";
import { AppLayout } from "@/app/AppLayout";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useSearchStore } from "@/features/search/store/search.store";
import { CommandPaletteHotkeys } from "@/app/CommandPaletteHotkeys";
import { ModalContainer } from "@/app/ModalContainer";
import { UnknownSchoolPage } from "@/app/UnknownSchoolPage";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";
import { Toaster } from "@/shared/ui/toaster";
import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { ROLE_ADMIN, ROLE_ORGANIZATION } from "@/shared/constants/roles";
import { getRouteDocumentTitle, ROUTES } from "@/shared/constants/routes";
import { getHostnameSchoolStatus } from "@/shared/constants/schools";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";

// Lazy load pages for code splitting
const ContactPage = lazy(() =>
  import("@/features/contact/pages/ContactPage").then((module) => ({
    default: module.ContactPage,
  }))
);
const OrganizationsPage = lazy(() =>
  import("@/features/organizations/pages/OrganizationsPage").then((module) => ({
    default: module.OrganizationsPage,
  }))
);
const MarketingPage = lazy(() =>
  import("@/features/marketing/pages/MarketingPage").then((module) => ({
    default: module.MarketingPage,
  }))
);
const SettingsPage = lazy(() =>
  import("@/features/settings/pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  }))
);
const AuthEntryPage = lazy(() =>
  import("@/features/auth/pages/AuthEntryPage").then((module) => ({
    default: module.AuthEntryPage,
  }))
);
const OnboardingPage = lazy(() =>
  import("@/features/onboarding/pages/OnboardingPage").then((module) => ({
    default: module.OnboardingPage,
  }))
);
const OnboardingDemoPage = lazy(() =>
  import("@/features/onboarding-demo/pages/OnboardingDemoPage").then((module) => ({
    default: module.OnboardingDemoPage,
  }))
);
const AuthCallbackPage = lazy(() =>
  import("@/features/auth/pages/AuthCallbackPage").then((module) => ({
    default: module.AuthCallbackPage,
  }))
);
const InviteLandingPage = lazy(() =>
  import("@/features/organizations/pages/InviteLandingPage").then((module) => ({
    default: module.InviteLandingPage,
  }))
);


// Admin Routes Configuration Lazy Loaded
const AdminPanelRoute = lazy(() =>
  import("@/app/routes/adminRoutes").then((m) => ({ default: m.AdminPanelRoute }))
);
const AdminEventsRoute = lazy(() =>
  import("@/app/routes/adminRoutes").then((m) => ({ default: m.AdminEventsRoute }))
);
const AdminOrganizationsRoute = lazy(() =>
  import("@/app/routes/adminRoutes").then((m) => ({ default: m.AdminOrganizationsRoute }))
);
const AdminPostersRoute = lazy(() =>
  import("@/app/routes/adminRoutes").then((m) => ({ default: m.AdminPostersRoute }))
);

// Organization Panel Routes Configuration Lazy Loaded
const OrganizationPanelRoute = lazy(() =>
  import("@/app/routes/organizationPanelRoutes").then((m) => ({ default: m.OrganizationPanelRoute }))
);
const OrganizationPanelPostersRoute = lazy(() =>
  import("@/app/routes/organizationPanelRoutes").then((m) => ({ default: m.OrganizationPanelPostersRoute }))
);
const OrganizationPanelIntegrationsRoute = lazy(() =>
  import("@/app/routes/organizationPanelRoutes").then((m) => ({ default: m.OrganizationPanelIntegrationsRoute }))
);
const OrganizationPanelMembersRoute = lazy(() =>
  import("@/app/routes/organizationPanelRoutes").then((m) => ({ default: m.OrganizationPanelMembersRoute }))
);

// QR Redirect Page Lazy Loaded
const QRRedirectPage = lazy(() =>
  import("@/features/qrcode/pages/QRRedirectPage").then((m) => ({ default: m.QRRedirectPage }))
);

export default function App() {
  const location = useLocation();
  const isQRRedirectRoute = /^\/qr\/[^/]+$/.test(location.pathname);
  const hostnameSchoolStatus =
    typeof window === "undefined"
      ? { candidate: null, isKnownSchool: true }
      : getHostnameSchoolStatus(window.location.hostname);

  // Full-page QR redirect: no app chrome, only loading then redirect
  if (isQRRedirectRoute) {
    return (
      <LazyMotion features={domMax} strict>
        <TooltipProvider delayDuration={0}>
          <QRRedirectPage />
        </TooltipProvider>
      </LazyMotion>
    );
  }

  if (!hostnameSchoolStatus.isKnownSchool && hostnameSchoolStatus.candidate) {
    return (
      <LazyMotion features={domMax} strict>
        <TooltipProvider delayDuration={0}>
          <UnknownSchoolPage requestedSchool={hostnameSchoolStatus.candidate} />
        </TooltipProvider>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domMax} strict>
      <TooltipProvider delayDuration={0}>
        <CommandPaletteHotkeys />
        <AppContent />
      </TooltipProvider>
    </LazyMotion>
  );
}

/**
 * Inner component that consumes auth state via narrow hooks.
 * Auth slices come from `useAuthState` (localStorage + event-bus backed).
 */
function AppContent() {
  const location = useLocation();
  const isAuthFlowRoute =
    location.pathname === ROUTES.LOGIN ||
    location.pathname === ROUTES.AUTH_CALLBACK ||
    location.pathname === ROUTES.ONBOARDING ||
    location.pathname === ROUTES.ONBOARDING_DEMO;

  const userEmail = useUserEmail();

  useEffect(() => {
    document.title = getRouteDocumentTitle(location.pathname);
  }, [location.pathname]);
  // Setter-only subscription. Setter refs are stable in Zustand, so this
  // does not cause AppContent to re-render when modal state changes — we
  // only need it for adminConfig/clubPanelConfig and
  // handleEditEventAndOpenModal. The modal state reads (showSubmitEvent,
  // showCommandPalette) live in `<ModalContainer />` to keep Routes from
  // re-rendering on modal toggles.
  // ── Store data (single source of truth) ──────────────────────
  const events = useEventsStore((s) => s.events);
  const setSchoolFilter = useEventsStore((s) => s.setSchoolFilter);

  // Trigger store fetches once on mount. Per-user stores (savedEvents,
  // credits, promotions) also listen to "auth-user-login" events so a
  // post-mount login refetches without needing this useEffect to re-run.
  useEffect(() => {
    if (isAuthFlowRoute) return;
    useSavedEventsStore.getState().fetchSavedEvents();
    useSavedOrganizationsStore.getState().fetchSavedOrganizations();
    useCreditsStore.getState().fetchBalance();
    useCreditsStore.getState().fetchActivePromotedEventIds();
  }, [isAuthFlowRoute]);


  // ── Search store setter (stable ref, selector-based subscription) ─
  // Avoid useSearchStore() with no selector — it would subscribe AppContent
  // to every filter-value change and re-render Routes on each keystroke.
  // Setter refs never change identity in Zustand, so narrow selectors
  // give us a no-op subscription.
  const setFilterStateFromURL = useSearchStore((s) => s.setFilterStateFromURL);

  // Called for side effects: processes URL params (filters, eventId scroll) on initial load
  useAppNavigation({
    events,
    setFilterStateFromURL,
    setSchoolFilter,
  });

  const appRoutes = (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<AuthEntryPage />} />
      <Route path={ROUTES.AUTH_CALLBACK} element={<AuthCallbackPage />} />
      <Route path={ROUTES.ONBOARDING} element={<OnboardingPage />} />
      <Route path={ROUTES.ONBOARDING_DEMO} element={<OnboardingDemoPage />} />
      <Route
        path={ROUTES.HOME}
        element={<EventsPageContainer />}
      />
      <Route path={ROUTES.CONTACT} element={<ContactPage />} />
      <Route path={ROUTES.ORGANIZATIONS} element={<OrganizationsPage />} />
      <Route path="/organizations" element={<Navigate to={ROUTES.ORGANIZATIONS} replace />} />
      <Route path="/club-panel" element={<Navigate to={ROUTES.ORGANIZATION_PANEL} replace />} />
      <Route path="/club-panel/*" element={<Navigate to={ROUTES.ORGANIZATION_PANEL} replace />} />
      <Route path={ROUTES.INVITE} element={<InviteLandingPage />} />

      <Route path={ROUTES.SETTINGS} element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route
        path={ROUTES.ADMIN}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminPanelRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_EVENTS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminEventsRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_ORGANIZATIONS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminOrganizationsRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_POSTERS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminPostersRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.MARKETING}
        element={
          <ProtectedRoute requiredRole={ROLE_ADMIN}>
            <MarketingPage
              events={events}
              userEmail={userEmail || ""}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTES.ORGANIZATION_PANEL}
        element={<ProtectedRoute requiredRole={ROLE_ORGANIZATION}><OrganizationPanelRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ORGANIZATION_PANEL_POSTERS}
        element={<ProtectedRoute requiredRole={ROLE_ORGANIZATION}><OrganizationPanelPostersRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ORGANIZATION_PANEL_INTEGRATIONS}
        element={<ProtectedRoute requiredRole={ROLE_ORGANIZATION}><OrganizationPanelIntegrationsRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ORGANIZATION_PANEL_MEMBERS}
        element={<ProtectedRoute requiredRole={ROLE_ORGANIZATION}><OrganizationPanelMembersRoute /></ProtectedRoute>}
      />
    </Routes>
  );

  return (
    <>
      {/* Modals - isolated in their own container so modal toggles don't re-render the Routes subtree */}
      <ModalContainer />
      <Toaster />

      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[400px]">
            <LoadingPage className="min-h-[400px]" />
          </div>
        }
      >
        {isAuthFlowRoute ? (
          appRoutes
        ) : (
          <AppLayout>

            {appRoutes}
          </AppLayout>
        )}
      </Suspense>
    </>
  );
}
