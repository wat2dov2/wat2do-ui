/**
 * Events Feature
 * Main export point for events feature
 * 
 * Architecture:
 * - pages/ - Page components
 * - components/ - Feature-specific UI components
 * - hooks/ - Feature-specific hooks
 * - api/ - Data layer (API calls, repositories)
 * - store/ - State management
 */

// Pages
export { EventsPageContainer } from "./pages/EventsPageContainer";
export { EventsPage } from "./pages/EventsPage";

// Components
export { EventCard } from "./components/EventCard";
export { EventList } from "./components/EventList";


// Additional Components
export { EventDetailsModal } from "./components/EventDetailsModal";
export { EventCount } from "./components/EventCount";
export { SubmitEventModal } from "./components/SubmitEventModal";

// Hooks
export { useAppEvents } from "./hooks/useAppEvents";
export { useSavedEvents } from "./hooks/useSavedEvents";

