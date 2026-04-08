import React, { Suspense, lazy, useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { LoadingPage } from "@/shared/ui/loading-page";
import { AppLayout } from "@/app/AppLayout";
import { EventsPageContainer, SubmitEventModal } from "@/features/events";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { BuyCreditsModal } from "@/features/credits/components/BuyCreditsModal";
import { EasterEggs } from "@/shared/components/EasterEggs";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useSearchStore } from "@/features/search/store/search.store";
import { useEasterEggs } from "@/shared/components/useEasterEggs";
import { ModalProvider, useModalContext } from "@/contexts/ModalContext";
import { UIProvider } from "@/contexts/UIContext";
import { UserProvider, useUserContext } from "@/contexts/UserContext";

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
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import { getDayOfWeek } from "@/shared/utils/date";
import { ROUTES } from "@/shared/constants/routes";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { usePromotionsStore } from "@/features/credits/store/promotions.store";
import type { Event, EventFormData } from "@/shared/types";

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

export default function App() {
  const location = useLocation();
  const isQRRedirectRoute = /^\/qr\/[^/]+$/.test(location.pathname);

  // Full-page QR redirect: no app chrome, only loading then redirect
  if (isQRRedirectRoute) {
    return (
      <UserProvider>
        <UIProvider>
          <ModalProvider>
            <TooltipProvider delayDuration={0}>
              <QRRedirectPage />
            </TooltipProvider>
          </ModalProvider>
        </UIProvider>
      </UserProvider>
    );
  }

  return (
    <UserProvider>
      <UIProvider>
        <ModalProvider>
          <TooltipProvider delayDuration={0}>
            <AppContent />
          </TooltipProvider>
        </ModalProvider>
      </UIProvider>
    </UserProvider>
  );
}

/**
 * Inner component that consumes context values.
 * Separated from App so that context providers are above this in the tree.
 */
function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Read from contexts (state is owned by the providers now)
  const { userEmail } = useUserContext();
  const {
    setShowOnboarding,
    showSubmitEvent,
    setShowSubmitEvent,
    showCommandPalette,
    setShowCommandPalette,
  } = useModalContext();

  // ── Store data (single source of truth) ──────────────────────
  const events = useEventsStore((s) => s.events);
  const storeAddEvent = useEventsStore((s) => s.addEvent);
  const storeUpdateEvent = useEventsStore((s) => s.updateEvent);
  const storeDeleteEvent = useEventsStore((s) => s.deleteEvent);

  const userCredits = usePromotionsStore((s) => s.userCredits);
  const storePromoteEvent = usePromotionsStore((s) => s.promoteEvent);
  const storeAddCredits = usePromotionsStore((s) => s.addCredits);

  // Trigger store fetches once on mount
  useEffect(() => {
    useEventsStore.getState().fetchEvents();
    useSavedEventsStore.getState().fetchSavedEvents();
    usePromotionsStore.getState().fetchPromotions();
  }, []);

  // ── getDayOfWeek for event mutations ─────────────────────────
  const getDayOfWeekFn = useCallback(
    (dateStr: string) => getDayOfWeek(dateStr, t),
    [t],
  );

  const addEvent = useCallback(
    (data: EventFormData) => storeAddEvent(data, getDayOfWeekFn),
    [storeAddEvent, getDayOfWeekFn],
  );

  const updateEvent = useCallback(
    (eventId: number, data: EventFormData) => storeUpdateEvent(eventId, data, getDayOfWeekFn),
    [storeUpdateEvent, getDayOfWeekFn],
  );

  const deleteEvent = storeDeleteEvent;

  // ── Edit event state (local UI) ──────────────────────────────
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  const handleEditEvent = useCallback((event: Event) => {
    setEditingEvent(event);
  }, []);

  const clearEditing = useCallback(() => {
    setEditingEvent(null);
  }, []);

  // ── Buy credits modal state (local UI) ───────────────────────
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const promoteEvent = useCallback(
    async (eventId: number, packageId: string): Promise<boolean> => {
      const result = await storePromoteEvent(eventId, packageId);
      if (result.needsCredits) {
        setShowBuyCredits(true);
        return false;
      }
      return result.success;
    },
    [storePromoteEvent],
  );

  // ── Easter eggs ──────────────────────────────────────────────
  const easterEggs = useEasterEggs();
  const { activeEasterEgg, clearEasterEgg } = easterEggs;

  // ── Search store (single source of truth — shared with EventsPageContainer) ─
  const searchStore = useSearchStore();

  // Called for side effects: processes URL params (filters, eventId scroll) on initial load
  useAppNavigation({
    events,
    filters: {
      setSearchQuery: searchStore.setSearchQuery,
      setSelectedCategories: searchStore.setSelectedCategories,
      setSelectedLocations: searchStore.setSelectedLocations,
      setSelectedFoods: searchStore.setSelectedFoods,
      setSelectedDays: searchStore.setSelectedDays,
      setPriceRange: searchStore.setPriceRange,
      setDateRange: searchStore.setDateRange,
      setAddedSince: searchStore.setAddedSince,
      setRequiresRegistration: searchStore.setRequiresRegistration,
      setFilterStateFromURL: searchStore.setFilterStateFromURL,
    },
  });

  // Handle submit event close
  const handleSubmitEventClose = useCallback(() => {
    setShowSubmitEvent(false);
    clearEditing();
  }, [setShowSubmitEvent, clearEditing]);

  // Open submit modal in edit mode
  const handleEditEventAndOpenModal = useCallback(
    (event: Parameters<typeof handleEditEvent>[0]) => {
      handleEditEvent({ id: event.id } as Parameters<typeof handleEditEvent>[0]);
      setShowSubmitEvent(true);
    },
    [handleEditEvent, setShowSubmitEvent]
  );

  const loadEventForEdit = useCallback(
    async (eventId: number) => {
      const { fetchEventById } = await import("@/features/events/api/events.api");
      const fullEvent = await fetchEventById(eventId);
      fullEvent.category = getEventCategory(fullEvent);
      return eventToFormData(fullEvent);
    },
    []
  );

  // Handle command palette filter actions
  const handleSetFreeFilter = useCallback(() => {
    searchStore.setFreeFilter(true);
  }, [searchStore]);

  const handleOpenOnboardingRoute = useCallback(() => {
    setShowOnboarding(false);
    navigate(ROUTES.ONBOARDING);
  }, [navigate, setShowOnboarding]);

  // Memoize admin route configuration
  const adminConfig = useMemo(
    () => ({
      events,
      onEditEvent: handleEditEventAndOpenModal,
      onDeleteEvent: deleteEvent,
      onCreateEvent: () => setShowSubmitEvent(true),
      onAddEvent: addEvent,
      userEmail,
    }),
    [events, handleEditEventAndOpenModal, deleteEvent, setShowSubmitEvent, addEvent, userEmail]
  );

  const isAuthFlowRoute = location.pathname === ROUTES.LOGIN || location.pathname === ROUTES.ONBOARDING;

  const appRoutes = (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<AuthEntryPage />} />
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
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminPanelRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_EVENTS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminEventsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_CLUBS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminClubsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_SUBMISSIONS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminSubmissionsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.ADMIN_POSTERS}
        element={<ProtectedRoute requiredRole={ROLE_ADMIN}><AdminPostersRoute config={adminConfig} /></ProtectedRoute>}
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
        element={<ProtectedRoute requiredRole={ROLE_CLUB}><ClubPanelRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path={ROUTES.CLUB_PANEL_POSTERS}
        element={<ProtectedRoute requiredRole={ROLE_CLUB}><ClubPanelPostersRoute config={adminConfig} /></ProtectedRoute>}
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
      {/* Modals - rendered outside AppLayout to ensure they respond to state changes immediately */}
      <SubmitEventModal
        isOpen={showSubmitEvent}
        onClose={handleSubmitEventClose}
        onSubmit={async (eventData) => addEvent(eventData)}
        userCredits={userCredits}
        onPromote={promoteEvent}
        onBuyCredits={() => setShowBuyCredits(true)}
        editEventId={editingEvent?.id}
        initialData={editingEvent && "title" in editingEvent ? eventToFormData(editingEvent) : undefined}
        loadEventForEdit={loadEventForEdit}
        onUpdate={async (eventId, eventData) => {
          await updateEvent(eventId, eventData);
          handleSubmitEventClose();
        }}
      />

      <BuyCreditsModal
        isOpen={showBuyCredits}
        onClose={() => setShowBuyCredits(false)}
        currentCredits={userCredits}
        onPurchase={storeAddCredits}
      />

      <CommandPalette
        isOpen={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        setShowFilterDropdown={searchStore.setShowFilterDropdown}
        onClearAllFilters={() => searchStore.clearAllFilters()}
        onSetFreeFilter={handleSetFreeFilter}
        onShowOnboarding={handleOpenOnboardingRoute}
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
