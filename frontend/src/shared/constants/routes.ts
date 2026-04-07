/**
 * Centralized route path definitions.
 *
 * Every client-side route string used in navigate(), <Route path=>, <Navigate to=>,
 * or pathname comparisons should reference this object instead of using a raw string.
 *
 * Sub-route maps (ADMIN_ROUTE_MAP, CLUB_PANEL_ROUTE_MAP) are also derived from these
 * constants so there is a single source of truth.
 */

// ── Top-level routes ───────────────────────────────────────────────
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  ONBOARDING: "/onboarding",
  ABOUT: "/about",
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
  return `${ROUTES.SETTINGS}?tab=${tab}`;
}

// ── Admin sub-route map (keyed by PageMode values used in navigation) ──
export const ADMIN_ROUTE_MAP: Record<string, string> = {
  "admin-events": ROUTES.ADMIN_EVENTS,
  "admin-clubs": ROUTES.ADMIN_CLUBS,
  "admin-submissions": ROUTES.ADMIN_SUBMISSIONS,
  "admin-posters": ROUTES.ADMIN_POSTERS,
};

// ── Club Panel sub-route map ───────────────────────────────────────
export const CLUB_PANEL_ROUTE_MAP: Record<string, string> = {
  "club-panel-posters": ROUTES.CLUB_PANEL_POSTERS,
  "club-panel-integrations": ROUTES.CLUB_PANEL_INTEGRATIONS,
  "club-panel-members": ROUTES.CLUB_PANEL_MEMBERS,
};
