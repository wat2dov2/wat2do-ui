import { Suspense, lazy, useMemo, useState, useEffect, useCallback } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { LazyMotion, domAnimation } from "framer-motion";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { LoadingPage } from "@/shared/ui/loading-page";
import { AppLayout } from "@/app/AppLayout";
import { EventsPageContainer } from "@/features/events";
import { EasterEggs } from "@/shared/components/EasterEggs";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useSearchStore } from "@/features/search/store/search.store";
import { useEasterEggs } from "@/shared/components/useEasterEggs";
import { useModalStore } from "@/shared/store/modal.store";
import { CommandPaletteHotkeys } from "@/app/CommandPaletteHotkeys";
import { ModalContainer } from "@/app/ModalContainer";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";

import {
  AdminPanelRoute,
  AdminEventsRoute,
  AdminClubsRoute,
  AdminSubmissionsRoute,
  AdminPostersRoute,
} from "@/app/routes/adminRoutes";
import { QRRedirectPage } from "@/features/qrcode/pages/QRRedirectPage";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { ROLE_ADMIN, ROLE_CLUB } from "@/shared/constants/roles";
import {
  ClubPanelRoute,
  ClubPanelPostersRoute,
  ClubPanelIntegrationsRoute,
  ClubPanelMembersRoute,
} from "@/app/routes/clubPanelRoutes";
import { ROUTES } from "@/shared/constants/routes";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useCreditsStore, usePromotionsStore } from "@/features/credits";
import type { Event } from "@/shared/types";

// Lazy load pages for code splitting
const AboutPage = lazy(() =>
  import("@/features/about").then((module) => ({
    default: module.AboutPage,
  }))
);
const ClubsPage = lazy(() =>
  import("@/features/clubs").then((module) => ({
    default: module.ClubsPage,
  }))
);
const MarketingPage = lazy(() =>
  import("@/features/marketing").then((module) => ({
    default: module.MarketingPage,
  }))
);
const SettingsPage = lazy(() =>
  import("@/features/settings").then((module) => ({
    default: module.SettingsPage,
  }))
);
const AuthEntryPage = lazy(() =>
  import("@/features/auth").then((module) => ({
    default: module.AuthEntryPage,
  }))
);
const OnboardingPage = lazy(() =>
  import("@/features/auth").then((module) => ({
    default: module.OnboardingPage,
  }))
);
const ForgotPasswordPage = lazy(() =>
  import("@/features/auth").then((module) => ({
    default: module.ForgotPasswordPage,
  }))
);
const ResetPasswordPage = lazy(() =>
  import("@/features/auth").then((module) => ({
    default: module.ResetPasswordPage,
  }))
);

export default function App() {
  const location = useLocation();
  const isQRRedirectRoute = /^\/qr\/[^/]+$/.test(location.pathname);

  // Full-page QR redirect: no app chrome, only loading then redirect
  if (isQRRedirectRoute) {
    return (
      <LazyMotion features={domAnimation} strict>
        <TooltipProvider delayDuration={0}>
          <QRRedirectPage />
        </TooltipProvider>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domAnimation} strict>
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
    location.pathname === ROUTES.FORGOT_PASSWORD ||
    location.pathname === ROUTES.RESET_PASSWORD ||
    location.pathname === ROUTES.ONBOARDING;

  const userEmail = useUserEmail();
  // Setter-only subscription. Setter refs are stable in Zustand, so this
  // does not cause AppContent to re-render when modal state changes — we
  // only need it for adminConfig/clubPanelConfig and
  // handleEditEventAndOpenModal. The modal state reads (showSubmitEvent,
  // showCommandPalette) live in `<ModalContainer />` to keep Routes from
  // re-rendering on modal toggles.
  const setShowSubmitEvent = useModalStore((s) => s.setShowSubmitEvent);

  // ── Store data (single source of truth) ──────────────────────
  const events = useEventsStore((s) => s.events);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);

  // Trigger store fetches once on mount. Per-user stores (savedEvents,
  // credits, promotions) also listen to "auth-user-login" events so a
  // post-mount login refetches without needing this useEffect to re-run.
  useEffect(() => {
    if (isAuthFlowRoute) return;
    useEventsStore.getState().fetchEvents();
    useSavedEventsStore.getState().fetchSavedEvents();
    useCreditsStore.getState().fetchBalance();
    usePromotionsStore.getState().fetchActivePromotedEventIds();
  }, [isAuthFlowRoute]);

  // ── Edit event state (local UI) ──────────────────────────────
  // Owned here (not in ModalContainer) because admin event routes need to
  // populate `editingEvent` before opening SubmitEventModal.
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  const handleEditEvent = useCallback((event: Event) => {
    setEditingEvent(event);
  }, []);

  const clearEditing = useCallback(() => {
    setEditingEvent(null);
  }, []);

  // ── Easter eggs ──────────────────────────────────────────────
  const easterEggs = useEasterEggs();
  const { activeEasterEgg, clearEasterEgg } = easterEggs;

  // ── Search store setter (stable ref, selector-based subscription) ─
  // Avoid useSearchStore() with no selector — it would subscribe AppContent
  // to every filter-value change and re-render Routes on each keystroke.
  // Setter refs never change identity in Zustand, so narrow selectors
  // give us a no-op subscription.
  const setFilterStateFromURL = useSearchStore((s) => s.setFilterStateFromURL);

  const navFilters = useMemo(
    () => ({ setFilterStateFromURL }),
    [setFilterStateFromURL],
  );

  // Called for side effects: processes URL params (filters, eventId scroll) on initial load
  useAppNavigation({
    events,
    filters: navFilters,
  });

  // Open submit modal in edit mode
  const handleEditEventAndOpenModal = useCallback(
    (event: Parameters<typeof handleEditEvent>[0]) => {
      handleEditEvent({ id: event.id } as Parameters<typeof handleEditEvent>[0]);
      setShowSubmitEvent(true);
    },
    [handleEditEvent, setShowSubmitEvent]
  );

  // Memoize admin route configuration. Admin pages read `events` from
  // `useEventsStore` directly and `userEmail` from `useUserEmail`, so
  // neither field belongs here.
  const adminConfig = useMemo(
    () => ({
      onEditEvent: handleEditEventAndOpenModal,
      onDeleteEvent: deleteEvent,
      onCreateEvent: () => setShowSubmitEvent(true),
    }),
    [handleEditEventAndOpenModal, deleteEvent, setShowSubmitEvent]
  );

  // Club-panel poster routes only need events + userEmail.
  const clubPanelConfig = useMemo(
    () => ({
      events,
      userEmail,
    }),
    [events, userEmail]
  );

  const appRoutes = (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<AuthEntryPage />} />
      <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
      <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
      <Route path={ROUTES.ONBOARDING} element={<OnboardingPage />} />
      <Route
        path={ROUTES.HOME}
        element={<EventsPageContainer />}
      />
      <Route path={ROUTES.ABOUT} element={<AboutPage />} />
      <Route path={ROUTES.CLUBS} element={<ClubsPage />} />
      <Route path={ROUTES.SETTINGS} element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route
        path={ROUTES.ADMIN}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminPanelRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_EVENTS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminEventsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_CLUBS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminClubsRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_SUBMISSIONS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminSubmissionsRoute /></ProtectedRoute>}
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
        path={ROUTES.CLUB_PANEL}
        element={<ProtectedRoute requiredRole={ROLE_CLUB}><ClubPanelRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.CLUB_PANEL_POSTERS}
        element={<ProtectedRoute requiredRole={ROLE_CLUB}><ClubPanelPostersRoute config={clubPanelConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.CLUB_PANEL_INTEGRATIONS}
        element={<ProtectedRoute requiredRole={ROLE_CLUB}><ClubPanelIntegrationsRoute /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.CLUB_PANEL_MEMBERS}
        element={<ProtectedRoute requiredRole={ROLE_CLUB}><ClubPanelMembersRoute /></ProtectedRoute>}
      />
    </Routes>
  );

  return (
    <>
      {/* Modals - isolated in their own container so modal toggles don't re-render the Routes subtree */}
      <ModalContainer
        editingEvent={editingEvent}
        clearEditing={clearEditing}
      />

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
            {/* Easter Eggs */}
            <EasterEggs
              activeEasterEgg={activeEasterEgg}
              onComplete={clearEasterEgg}
            />

            {appRoutes}
          </AppLayout>
        )}
      </Suspense>
    </>
  );
}
