/**
 * Centralized route path definitions.
 *
 * Every client-side route string used in navigate(), <Route path=>, <Navigate to=>,
 * or pathname comparisons should reference this object instead of using a raw string.
 *
 * Sub-route maps (ADMIN_ROUTE_MAP, CLUB_PANEL_ROUTE_MAP) are also derived from these
 * constants so there is a single source of truth.
 */

import { QP } from "@/shared/constants/queryParams";

// ── Top-level routes ───────────────────────────────────────────────
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  ONBOARDING: "/onboarding",
  CONTACT: "/contact",
  CLUBS: "/clubs",
  SETTINGS: "/settings",
  MARKETING: "/marketing",

  // Admin
  ADMIN: "/admin",
  ADMIN_EVENTS: "/admin/events",
  ADMIN_CLUBS: "/admin/clubs",
  ADMIN_SUBMISSIONS: "/admin/submissions",
  ADMIN_POSTERS: "/admin/posters",

  // Club Panel
  CLUB_PANEL: "/club-panel",
  CLUB_PANEL_POSTERS: "/club-panel/posters",
  CLUB_PANEL_INTEGRATIONS: "/club-panel/integrations",
  CLUB_PANEL_MEMBERS: "/club-panel/members",
} as const;

// ── Settings sub-tabs (used as query params: /settings?tab=<tab>) ──
export const SETTINGS_TABS = {
  PROFILE: "profile",
  NOTIFICATIONS: "notifications",
  APPEARANCE: "appearance",
  PRIVACY: "privacy",
} as const;

/** Build a settings URL with a specific tab selected. */
export function settingsTabPath(tab: (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS]): string {
  return `${ROUTES.SETTINGS}?${QP.TAB}=${tab}`;
}

// ── Admin sub-route map ────────────────────────────────────────────
export const ADMIN_ROUTE_MAP = {
  "admin-events": ROUTES.ADMIN_EVENTS,
  "admin-clubs": ROUTES.ADMIN_CLUBS,
  "admin-submissions": ROUTES.ADMIN_SUBMISSIONS,
  "admin-posters": ROUTES.ADMIN_POSTERS,
} as const;

export type AdminRouteKey = keyof typeof ADMIN_ROUTE_MAP;

// ── Club Panel sub-route map ───────────────────────────────────────
export const CLUB_PANEL_ROUTE_MAP = {
  "club-panel-posters": ROUTES.CLUB_PANEL_POSTERS,
  "club-panel-integrations": ROUTES.CLUB_PANEL_INTEGRATIONS,
  "club-panel-members": ROUTES.CLUB_PANEL_MEMBERS,
} as const;

export type ClubPanelRouteKey = keyof typeof CLUB_PANEL_ROUTE_MAP;
