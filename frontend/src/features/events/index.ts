/**
 * Events Feature — public re-exports actually consumed outside this feature.
 */

export { EventsPageContainer } from "./pages/EventsPageContainer";
export { EventList } from "./components/EventList";
export { EventCount } from "./components/EventCount";
export { EventDetailsModal } from "./components/EventDetailsModal";
export { SubmitEventModal } from "./components/SubmitEventModal";
export { SidebarEventsSection } from "./components/SidebarEventsSection";

export { computeEventBadges } from "./hooks/useEventBadges";
export { fetchAllEvents, fetchEventById } from "./api/events.api";
export { useEventsStore } from "./store/events.store";

