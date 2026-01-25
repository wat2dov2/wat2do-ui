import React, { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Event } from "@/types";
import { OnboardingModal } from "@/components/OnboardingModal";
import { AppLayout } from "@/components/AppLayout";
import { EventsPageContainer } from "@/components/EventsPageContainer";
import { CommandPalette } from "@/components/CommandPalette";
import { SubmitEventModal } from "@/components/SubmitEventModal";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { GettingStartedChecklist } from "@/components/GettingStartedChecklist";
import { EasterEggs } from "@/components/EasterEggs";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useAppFilters } from "@/hooks/useAppFilters";
import { useAppPromotions } from "@/hooks/useAppPromotions";
import { useAppUI } from "@/hooks/useAppUI";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useSavedEvents } from "@/hooks/useSavedEvents";
import { useEasterEggs } from "@/hooks/useEasterEggs";

// Lazy load pages for code splitting
const AboutPage = lazy(() =>
  import("@/components/AboutPage").then((module) => ({
    default: module.AboutPage,
  }))
);
const ClubsPage = lazy(() =>
  import("@/components/ClubsPage").then((module) => ({
    default: module.ClubsPage,
  }))
);
const AdminPanel = lazy(() =>
  import("@/components/AdminPanel").then((module) => ({
    default: module.AdminPanel,
  }))
);
const AdminEventsPage = lazy(() =>
  import("@/components/AdminEventsPage").then((module) => ({
    default: module.AdminEventsPage,
  }))
);
const AdminClubsPage = lazy(() =>
  import("@/components/AdminClubsPage").then((module) => ({
    default: module.AdminClubsPage,
  }))
);
const AdminSubmissionsPage = lazy(() =>
  import("@/components/AdminSubmissionsPage").then((module) => ({
    default: module.AdminSubmissionsPage,
  }))
);
const AdminPostersPage = lazy(() =>
  import("@/components/AdminPostersPage").then((module) => ({
    default: module.AdminPostersPage,
  }))
);
const MarketingPage = lazy(() =>
  import("@/components/MarketingPage").then((module) => ({
    default: module.MarketingPage,
  }))
);
const SettingsPage = lazy(() =>
  import("@/components/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  }))
);


export default function App() {
  // Initialize hooks
  const appEvents = useAppEvents();
  const appUI = useAppUI();
  const savedEvents = useSavedEvents();
  const easterEggs = useEasterEggs();
  
  // Get events and profile completion for filters
  const { events, addEvent, updateEvent, deleteEvent, editingEvent, handleEditEvent, eventToFormData, clearEditing } = appEvents;
  const { savedEventIds, toggleSaveEvent } = savedEvents;
  
  // Initialize filters hook with events and profile
  const { profileCompleted } = appUI;
  const filters = useAppFilters({ events, profileCompleted, savedEventIds });
  
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
    sidebarHovered,
    setSidebarHovered,
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
  
  // Handle onboarding completion
  const handleOnboardingComplete = (data: { email?: string }) => {
    setUIProfileCompleted(true);
    if (data.email) {
      setUserEmail(data.email);
    }
  };
  
  // Handle submit event close
  const handleSubmitEventClose = () => {
    setShowSubmitEvent(false);
    clearEditing();
  };
  
  // Handle command palette filter actions
  const handleSetTodayFilter = () => {
    filters.setTodayFilter(true);
  };
  
  const handleSetFreeFilter = () => {
    filters.setFreeFilter(true);
  };
  
  const handleSetForYouFilter = () => {
    filters.setForYouFilter(true);
  };

  // Get navigation helpers
  const { navigate } = navigation;
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={0}>
      <AppLayout
        pageMode={pageMode}
        sidebarHovered={sidebarHovered}
        setSidebarHovered={setSidebarHovered}
        eventsExpanded={eventsExpanded}
        setEventsExpanded={setEventsExpanded}
        selectedSchool={selectedSchool}
        setSelectedSchool={setSelectedSchool}
        profileCompleted={isProfileCompleted}
        setProfileCompleted={setUIProfileCompleted}
        setUserEmail={setUserEmail}
        showCommandPalette={showCommandPalette}
        setShowCommandPalette={setShowCommandPalette}
        setShowOnboarding={setShowOnboarding}
        setShowSubmitEvent={setShowSubmitEvent}
      >
        {/* Easter Eggs */}
        <EasterEggs
          activeEasterEgg={activeEasterEgg}
          onComplete={clearEasterEgg}
        />

        {/* Onboarding Modal */}
        <OnboardingModal
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
          onComplete={handleOnboardingComplete}
        />

        {/* Getting Started Checklist - only show when signed in */}
        {isProfileCompleted && (
          <GettingStartedChecklist
            onOpenOnboarding={() => setShowOnboarding(true)}
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

        {/* Submit Event Modal */}
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

        {/* Buy Credits Modal */}
        <BuyCreditsModal
          isOpen={showBuyCredits}
          onClose={() => setShowBuyCredits(false)}
          currentCredits={userCredits}
          onPurchase={addCredits}
        />

        {/* Command Palette */}
        <CommandPalette
          isOpen={showCommandPalette}
          onOpenChange={setShowCommandPalette}
          profileCompleted={isProfileCompleted}
          viewMode={viewMode}
          setViewMode={setViewMode}
          setShowFilterDropdown={filters.setShowFilterDropdown}
          setShowSubmitEvent={setShowSubmitEvent}
          setShowOnboarding={setShowOnboarding}
          onClearAllFilters={filters.handleClearAllFilters}
          onSetTodayFilter={handleSetTodayFilter}
          onSetFreeFilter={handleSetFreeFilter}
          onSetForYouFilter={handleSetForYouFilter}
        />

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
          <Routes>
            <Route
              path="/"
              element={
                <EventsPageContainer
                  profileCompleted={isProfileCompleted}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  filterViewMode={filterViewMode}
                  setFilterViewMode={setFilterViewMode}
                  isDarkMode={isDarkMode}
                  isAdmin={isAdmin}
                />
              }
            />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/clubs" element={<ClubsPage />} />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  profileCompleted={isProfileCompleted}
                  onOpenOnboarding={() => setShowOnboarding(true)}
                  userEmail={userEmail}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  filterViewMode={filterViewMode}
                  setFilterViewMode={setFilterViewMode}
                />
              }
            />
            <Route
              path="/admin"
              element={
                <AdminPanel
                  events={events}
                  onNavigate={(page) => {
                    if (page === "admin-events") navigate("/admin/events");
                    else if (page === "admin-clubs")
                      navigate("/admin/clubs");
                    else if (page === "admin-submissions")
                      navigate("/admin/submissions");
                    else if (page === "admin-posters")
                      navigate("/admin/posters");
                    else navigate("/admin");
                  }}
                />
              }
            />
            <Route
              path="/admin/events"
              element={
                <AdminEventsPage
                  events={events}
                  onEditEvent={handleEditEvent}
                  onDeleteEvent={deleteEvent}
                  onBack={() => navigate("/admin")}
                  onCreateEvent={() => setShowSubmitEvent(true)}
                />
              }
            />
            <Route
              path="/admin/clubs"
              element={
                <AdminClubsPage
                  onBack={() => navigate("/admin")}
                  onAddClub={() => {
                    // TODO: Implement add club functionality
                  }}
                  onEditClub={() => {
                    // TODO: Implement edit club functionality
                  }}
                  onDeleteClub={() => {
                    // TODO: Implement delete club functionality
                  }}
                />
              }
            />
            <Route
              path="/admin/submissions"
              element={
                <AdminSubmissionsPage
                  onBack={() => navigate("/admin")}
                  onApprove={(submission) => {
                    // Convert submission to event and add it
                    const eventData = submission.eventData;
                    addEvent({
                      title: eventData.title,
                      description: eventData.description,
                      date: eventData.date,
                      time: eventData.time,
                      location: eventData.location,
                      category: eventData.category || "Events",
                      price: eventData.price,
                      food: eventData.food,
                      requiresRegistration: eventData.requiresRegistration,
                      organization: eventData.organization,
                    });
                  }}
                />
              }
            />
            <Route
              path="/admin/posters"
              element={
                <AdminPostersPage
                  onBack={() => navigate("/admin")}
                  events={events}
                  userEmail={userEmail || ""}
                />
              }
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
          </Routes>
        </Suspense>
      </AppLayout>
    </TooltipProvider>
  );
}
