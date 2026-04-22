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

// Components
export { EventCard } from "./components/EventCard";
export { EventList } from "./components/EventList";


// Additional Components
export { EventDetailsModal } from "./components/EventDetailsModal";
export { EventCount } from "./components/EventCount";
export { SubmitEventModal } from "./components/SubmitEventModal";
export { SidebarEventsSection } from "./components/SidebarEventsSection";

// Hooks
export { useLatestAddedEvent } from "./hooks/useLatestAddedEvent";

// Utils (public API for cross-feature use)
export { computeEventBadges } from "./hooks/useEventBadges";

// API (public API for cross-feature use)
export { fetchAllEvents, fetchEventById } from "./api/events.api";

// Store (public surface for cross-feature read access)
export { useEventsStore } from "./store/events.store";

