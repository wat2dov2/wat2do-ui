import React, { Suspense, lazy, useMemo } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { GettingStartedChecklist } from "@/features/auth";
import { AppLayout } from "@/app/AppLayout";
import { EventsPageContainer, SubmitEventModal, useAppEvents, useSavedEvents } from "@/features/events";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { CommandPaletteProvider } from "@/features/commands/context/CommandPaletteContext";
import { BuyCreditsModal } from "@/features/credits/components/BuyCreditsModal";
import { EasterEggs } from "@/shared/components/EasterEggs";
import { useSearch } from "@/features/search";
import { useAppPromotions } from "@/app/hooks/useAppPromotions";
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
import {
  ClubPanelRoute,
  ClubPanelPostersRoute,
  ClubPanelIntegrationsRoute,
  ClubPanelMembersRoute,
} from "@/app/routes/clubPanelRoutes";

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

  // Initialize hooks
  const appEvents = useAppEvents();
  const appUI = useAppUI();
  const savedEvents = useSavedEvents();
  const easterEggs = useEasterEggs();
  
  // Get events and profile completion for filters
  const { events, addEvent, updateEvent, deleteEvent, editingEvent, handleEditEvent, eventToFormData, clearEditing } = appEvents;
  const { savedEventIds } = savedEvents;
  
  // Initialize filters hook with events and profile
  const { profileCompleted } = appUI;
  const filters = useSearch({ events, profileCompleted, savedEventIds });
  
  // Initialize promotions hook
  const promotions = useAppPromotions();
  
  // Initialize navigation hook with events and filter setters
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
  
  // Get promotions state
  const { userCredits, promoteEvent, showBuyCredits, setShowBuyCredits, addCredits } = promotions;
  
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

  // Handle command palette filter actions
  const handleSetFreeFilter = useCallback(() => {
    filters.setFreeFilter(true);
  }, [filters]);

  const handleSetForYouFilter = useCallback(() => {
    filters.setForYouFilter(true);
  }, [filters]);

  const handleOpenOnboardingRoute = useCallback(() => {
    setShowOnboarding(false);
    navigate("/onboarding");
  }, [navigate, setShowOnboarding]);

  // Get navigation helpers
  const { t } = useTranslation();

  // Memoize admin route configuration
  const adminConfig = useMemo(
    () => ({
      events,
      onEditEvent: handleEditEvent,
      onDeleteEvent: deleteEvent,
      onCreateEvent: () => setShowSubmitEvent(true),
      onAddEvent: addEvent,
      userEmail,
    }),
    [events, handleEditEvent, deleteEvent, setShowSubmitEvent, addEvent, userEmail]
  );

  const isAuthFlowRoute = location.pathname === "/auth" || location.pathname === "/onboarding";

  const appRoutes = (
    <Routes>
      <Route path="/auth" element={<AuthEntryPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route
        path="/"
        element={<EventsPageContainer />}
      />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/clubs" element={<ClubsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route
        path="/admin"
        element={<AdminPanelRoute config={adminConfig} />}
      />
      <Route
        path="/admin/events"
        element={<AdminEventsRoute config={adminConfig} />}
      />
      <Route
        path="/admin/clubs"
        element={<AdminClubsRoute config={adminConfig} />}
      />
      <Route
        path="/admin/submissions"
        element={<AdminSubmissionsRoute config={adminConfig} />}
      />
      <Route
        path="/admin/posters"
        element={<AdminPostersRoute config={adminConfig} />}
      />
      <Route
        path="/marketing"
        element={
          <MarketingPage
            events={events}
            userEmail={userEmail || ""}
          />
        }
      />
      <Route
        path="/club-panel"
        element={<ClubPanelRoute config={adminConfig} />}
      />
      <Route
        path="/club-panel/posters"
        element={<ClubPanelPostersRoute config={adminConfig} />}
      />
      <Route
        path="/club-panel/integrations"
        element={<ClubPanelIntegrationsRoute />}
      />
      <Route
        path="/club-panel/members"
        element={<ClubPanelMembersRoute />}
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
          onSubmit={(eventData) => {
            const eventId = addEvent(eventData);
            return eventId;
          }}
          userCredits={userCredits}
          onPromote={promoteEvent}
          onBuyCredits={() => setShowBuyCredits(true)}
          editEventId={editingEvent?.id}
          initialData={editingEvent ? eventToFormData(editingEvent) : undefined}
          onUpdate={(eventId, eventData) => {
            updateEvent(eventId, eventData);
            handleSubmitEventClose();
          }}
        />

        <BuyCreditsModal
          isOpen={showBuyCredits}
          onClose={() => setShowBuyCredits(false)}
          currentCredits={userCredits}
          onPurchase={addCredits}
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
            onSetForYouFilter: handleSetForYouFilter,
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
              <div className="text-center space-y-4">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent"></div>
                <p className="text-sm text-muted-foreground">
                  {t("common.loadingPage")}
                </p>
              </div>
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

              {/* Getting Started Checklist - only show when signed in */}
              {isProfileCompleted && (
                <GettingStartedChecklist
                  onOpenOnboarding={handleOpenOnboardingRoute}
                  onNavigateToFilters={() => filters.setShowFilterDropdown(true)}
                  onViewEvent={() => {
                    // Auto-scroll to first event card
                    const firstCard = document.querySelector("[data-event-card]");
                    firstCard?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    });
                  }}
                  profileCompleted={isProfileCompleted}
                />
              )}
              {appRoutes}
            </AppLayout>
          )}
        </Suspense>
        </TooltipProvider>
      </NavigationProvider>
    </AppProvider>
  );
}
