/**
 * Events Store (Zustand)
 *
 * Client state for the events feature: school filter, embedded browse snapshot
 * for cross-route consumers, and mutations.
 */

import { create } from "zustand";
import type { Event as AppEvent, EventFormData } from "@/shared/types";
import {
  type LatestAddedEvent,
  type PaginatedEventsResponse,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";
import {
  DEFAULT_SCHOOL,
  getCurrentSchool,
  getHostnameSchoolStatus,
  resolveSchool,
} from "@/shared/constants/schools";
import { QP } from "@/shared/constants/queryParams";
import { AUTH_STATE_REFRESH_EVENT, loadUserProfile } from "@/features/auth/api/userRepository";

interface EventsState {
  events: AppEvent[];
  latestAddedEvent: LatestAddedEvent;
  isLoading: boolean;
  error: string | null;
  schoolFilter: string | null;
  /**
   * Whether the server's browse snapshot has been handed to this store.
   *
   * Zustand is client-only, so the store is still empty during the server
   * render and on the first client render. Consumers read the snapshot
   * directly until this turns true, which keeps both of those renders
   * identical to every render after it.
   */
  hasHydratedInitialFeed: boolean;

  hydrateInitialFeed: (
    feed: PaginatedEventsResponse,
    school: string | null,
  ) => void;
  setSchoolFilter: (school: string) => void;
  addEvent: (data: EventFormData) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
}

function getRouteSchool(): string | null {
  if (typeof window !== "undefined") {
    const schoolParam = new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim();
    if (schoolParam) return resolveSchool(schoolParam);

    const hostnameSchool = getHostnameSchoolStatus(window.location.hostname);
    if (hostnameSchool.candidate) {
      return hostnameSchool.school;
    }
  }

  return null;
}

function getInitialSchoolFilter(): string {
  return resolveSchool(getRouteSchool() || loadUserProfile()?.school || getCurrentSchool());
}

function removeEventFromState(state: EventsState, eventId: number): Partial<EventsState> {
  return {
    events: state.events.filter((event) => event.id !== eventId),
  };
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  latestAddedEvent: null,
  isLoading: true,
  error: null,
  schoolFilter: getInitialSchoolFilter(),
  hasHydratedInitialFeed: false,

  hydrateInitialFeed: (feed, school) => {
    const nextSchool = school ? resolveSchool(school) : get().schoolFilter;

    set({
      events: feed.items,
      latestAddedEvent: feed.latest_added_event ?? null,
      isLoading: false,
      error: null,
      schoolFilter: nextSchool,
      hasHydratedInitialFeed: true,
    });
  },

  setSchoolFilter: (school: string) => {
    const nextSchool = resolveSchool(school);
    if (get().schoolFilter === nextSchool) return;
    set({ schoolFilter: nextSchool });
  },

  addEvent: async (data) => {
    const created = await createEventAPI(data);

    set((state) => ({
      events: getUniqueEvents([created, ...state.events]),
      latestAddedEvent: { title: created.title, added_at: created.added_at },
    }));
    return created.id;
  },

  updateEvent: async (eventId, data) => {
    const updated = await updateEventAPI(eventId, data);

    set((state) => ({
      events: state.events.map((event) => (event.id === eventId ? updated : event)),
      latestAddedEvent:
        state.latestAddedEvent?.added_at === updated.added_at
          ? { title: updated.title, added_at: updated.added_at }
          : state.latestAddedEvent,
    }));
  },

  deleteEvent: async (eventId) => {
    await deleteEventAPI(eventId);
    set((state) => removeEventFromState(state, eventId));
  },
}));

function getAuthLoginSchool(event: globalThis.Event): string {
  const routeSchool = getRouteSchool();
  if (routeSchool) return routeSchool;

  if ("detail" in event) {
    const detail = (event as CustomEvent<{ school?: string }>).detail;
    const hintedSchool = detail?.school?.trim();
    if (hintedSchool) return resolveSchool(hintedSchool);
  }

  return resolveSchool(loadUserProfile()?.school || getCurrentSchool());
}

function syncSchoolFilterFromLogin(event: globalThis.Event): void {
  const nextSchool = getAuthLoginSchool(event);
  const currentSchool = useEventsStore.getState().schoolFilter;
  if (currentSchool !== nextSchool) {
    useEventsStore.getState().setSchoolFilter(nextSchool);
  }
}

function syncSchoolFilterFromProfile(): void {
  const routeSchool = getRouteSchool();
  const nextSchool = resolveSchool(routeSchool || loadUserProfile()?.school || getCurrentSchool());
  const currentSchool = useEventsStore.getState().schoolFilter;
  if (currentSchool !== nextSchool) {
    useEventsStore.getState().setSchoolFilter(nextSchool);
  }
}

function resetSchoolFilterOnLogout(): void {
  // A school subdomain still scopes the feed once the profile is gone.
  const nextSchool = getRouteSchool() ?? DEFAULT_SCHOOL;
  if (useEventsStore.getState().schoolFilter !== nextSchool) {
    useEventsStore.getState().setSchoolFilter(nextSchool);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth-user-login", syncSchoolFilterFromLogin);
  window.addEventListener(AUTH_STATE_REFRESH_EVENT, syncSchoolFilterFromProfile);
  window.addEventListener("auth-user-logout", resetSchoolFilterOnLogout);
}
