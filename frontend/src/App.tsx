import React, { Suspense, lazy, useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { LoadingPage } from "@/shared/ui/loading-page";
import { AppLayout } from "@/app/AppLayout";
import { EventsPageContainer, SubmitEventModal } from "@/features/events";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { CommandPaletteProvider } from "@/features/commands/context/CommandPaletteContext";
import { BuyCreditsModal } from "@/features/credits/components/BuyCreditsModal";
import { EasterEggs } from "@/shared/components/EasterEggs";
import { useSearch } from "@/features/search";
import { useAppUI } from "@/app/hooks/useAppUI";
import { useAppNavigation } from "@/app/hooks/useAppNavigation";
import { useEasterEggs } from "@/shared/components/useEasterEggs";
import { AppProvider } from "@/contexts/AppContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import {
  AdminPanelRoute,
  AdminEventsRoute,
  AdminClubsRoute,
  AdminSubmissionsRoute,
  AdminPostersRoute,
} from "@/app/routes/adminRoutes";
import { QRRedirectPage } from "@/features/qrcode/pages/QRRedirectPage";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import {
  ClubPanelRoute,
  ClubPanelPostersRoute,
  ClubPanelIntegrationsRoute,
  ClubPanelMembersRoute,
} from "@/app/routes/clubPanelRoutes";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import { getDayOfWeek } from "@/shared/utils/date";
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
  const navigate = useNavigate();
  const { t } = useTranslation();

  // ── Store data (single source of truth) ──────────────────────
  const events = useEventsStore((s) => s.events);
  const storeAddEvent = useEventsStore((s) => s.addEvent);
  const storeUpdateEvent = useEventsStore((s) => s.updateEvent);
  const storeDeleteEvent = useEventsStore((s) => s.deleteEvent);

  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);

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
    async (eventId: number, packageId: string, credits: number, duration: number): Promise<boolean> => {
      const result = await storePromoteEvent(eventId, packageId, credits, duration);
      if (result.needsCredits) {
        setShowBuyCredits(true);
        return false;
      }
      return result.success;
    },
    [storePromoteEvent],
  );

  // ── UI hooks ─────────────────────────────────────────────────
  const appUI = useAppUI();
  const easterEggs = useEasterEggs();

  const { profileCompleted } = appUI;
  const filters = useSearch({ events, profileCompleted, savedEventIds });

  const navigation = useAppNavigation({
    events,
    filters: {
      setSearchQuery: filters.setSearchQuery,
      setSelectedCategories: filters.setSelectedCategories,
      setSelectedLocations: filters.setSelectedLocations,
      setSelectedFoods: filters.setSelectedFoods,
      setSelectedDays: filters.setSelectedDays,
      setPriceRange: filters.setPriceRange,
      setDateRange: filters.setDateRange,
      setAddedSince: filters.setAddedSince,
      setRequiresRegistration: filters.setRequiresRegistration,
      setFilterStateFromURL: filters.setFilterStateFromURL,
    },
  });

  // Get UI state
  const {
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,
    showOnboarding,
    setShowOnboarding,
    showSubmitEvent,
    setShowSubmitEvent,
    showCommandPalette,
    setShowCommandPalette,
    profileCompleted: uiProfileCompleted,
    setProfileCompleted: setUIProfileCompleted,
    userEmail,
    setUserEmail,
    isAdmin,
    eventsExpanded,
    setEventsExpanded,
    selectedSchool,
    setSelectedSchool,
    isDarkMode,
  } = appUI;

  // Get easter eggs
  const { activeEasterEgg, clearEasterEgg } = easterEggs;

  // Get page mode from navigation
  const { pageMode } = navigation;

  // Combine profile completion from both hooks
  const isProfileCompleted = profileCompleted || uiProfileCompleted;

  // Create context value - memoized to prevent unnecessary re-renders
  const appContextValue = useMemo(() => ({
    // Navigation
    pageMode,

    // UI State
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,

    // Sidebar
    eventsExpanded,
    setEventsExpanded,

    // School
    selectedSchool,
    setSelectedSchool,

    // Modals
    showOnboarding,
    setShowOnboarding,
    showSubmitEvent,
    setShowSubmitEvent,
    showCommandPalette,
    setShowCommandPalette,

    // Profile
    profileCompleted: isProfileCompleted,
    setProfileCompleted: setUIProfileCompleted,
    userEmail,
    setUserEmail,

    // Dark mode
    isDarkMode,

    // Admin
    isAdmin,
  }), [
    pageMode,
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,
    eventsExpanded,
    setEventsExpanded,
    selectedSchool,
    setSelectedSchool,
    showOnboarding,
    setShowOnboarding,
    showSubmitEvent,
    setShowSubmitEvent,
    showCommandPalette,
    setShowCommandPalette,
    isProfileCompleted,
    setUIProfileCompleted,
    userEmail,
    setUserEmail,
    isDarkMode,
    isAdmin,
  ]);

  // Handle submit event close
  const handleSubmitEventClose = useCallback(() => {
    setShowSubmitEvent(false);
    clearEditing();
  }, [setShowSubmitEvent, clearEditing]);

  // Open submit modal in edit mode (used by admin and anywhere that has an Edit button).
  // Pass event id so the modal can fetch and populate the form (SubmitEventModal uses loadEventForEdit).
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
    filters.setFreeFilter(true);
  }, [filters]);

  const handleOpenOnboardingRoute = useCallback(() => {
    setShowOnboarding(false);
    navigate("/onboarding");
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

  const isAuthFlowRoute = location.pathname === "/login" || location.pathname === "/onboarding";
  const isQRRedirectRoute = /^\/qr\/[^/]+$/.test(location.pathname);

  // Full-page QR redirect: no app chrome, only loading then redirect (avoids events page flash)
  if (isQRRedirectRoute) {
    return (
      <AppProvider value={appContextValue}>
        <NavigationProvider>
          <TooltipProvider delayDuration={0}>
            <QRRedirectPage />
          </TooltipProvider>
        </NavigationProvider>
      </AppProvider>
    );
  }

  const appRoutes = (
    <Routes>
      <Route path="/login" element={<AuthEntryPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route
        path="/"
        element={<EventsPageContainer />}
      />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/clubs" element={<ClubsPage />} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route
        path="/admin"
        element={<ProtectedRoute requiredRole="admin"><AdminPanelRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/admin/events"
        element={<ProtectedRoute requiredRole="admin"><AdminEventsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/admin/clubs"
        element={<ProtectedRoute requiredRole="admin"><AdminClubsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/admin/submissions"
        element={<ProtectedRoute requiredRole="admin"><AdminSubmissionsRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/admin/posters"
        element={<ProtectedRoute requiredRole="admin"><AdminPostersRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/marketing"
        element={
          <ProtectedRoute requiredRole="admin">
            <MarketingPage
              events={events}
              userEmail={userEmail || ""}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club-panel"
        element={<ProtectedRoute requiredRole="club"><ClubPanelRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/club-panel/posters"
        element={<ProtectedRoute requiredRole="club"><ClubPanelPostersRoute config={adminConfig} /></ProtectedRoute>}
      />
      <Route
        path="/club-panel/integrations"
        element={<ProtectedRoute requiredRole="club"><ClubPanelIntegrationsRoute /></ProtectedRoute>}
      />
      <Route
        path="/club-panel/members"
        element={<ProtectedRoute requiredRole="club"><ClubPanelMembersRoute /></ProtectedRoute>}
      />
    </Routes>
  );

  return (
    <AppProvider value={appContextValue}>
      <NavigationProvider>
        <TooltipProvider delayDuration={0}>
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

        <CommandPaletteProvider
          value={{
            profileCompleted: isProfileCompleted,
            viewMode,
            setViewMode,
            setShowFilterDropdown: filters.setShowFilterDropdown,
            setShowSubmitEvent,
            setShowOnboarding: (show) => {
              if (show) {
                handleOpenOnboardingRoute();
                return;
              }
              setShowOnboarding(false);
            },
            onClearAllFilters: filters.handleClearAllFilters,
            onSetFreeFilter: handleSetFreeFilter,
          }}
        >
          <CommandPalette
            isOpen={showCommandPalette}
            onOpenChange={setShowCommandPalette}
          />
        </CommandPaletteProvider>

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
        </TooltipProvider>
      </NavigationProvider>
    </AppProvider>
  );
}
