/** School preference and authentication broadcasts for event-related forms. */

import { create } from "zustand";
import {
  DEFAULT_SCHOOL,
  getCurrentSchool,
  getHostnameSchoolStatus,
  resolveSchool,
} from "@/shared/constants/schools";
import { QP } from "@/shared/constants/queryParams";
import { AUTH_STATE_REFRESH_EVENT, loadUserProfile } from "@/features/auth/api/userRepository";

interface EventsState {
  schoolFilter: string | null;
  setSchoolFilter: (school: string) => void;
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

export const useEventsStore = create<EventsState>((set, get) => ({
  schoolFilter: getInitialSchoolFilter(),
  setSchoolFilter: (school: string) => {
    const nextSchool = resolveSchool(school);
    if (get().schoolFilter !== nextSchool) set({ schoolFilter: nextSchool });
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
