/**
 * Centralized route path definitions.
 *
 * Every client-side route string used in navigate(), <Route path=>, <Navigate to=>,
 * or pathname comparisons should reference this object instead of using a raw string.
 *
 * Sub-route maps (ADMIN_ROUTE_MAP, ORGANIZATION_PANEL_ROUTE_MAP) are also derived from these
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
  ORGANIZATIONS: "/organizations",
  SETTINGS: "/settings",
  MARKETING: "/marketing",
  INVITE: "/invite/:token",


  // Admin
  ADMIN: "/admin",
  ADMIN_EVENTS: "/admin/events",
  ADMIN_ORGANIZATIONS: "/admin/organizations",
  ADMIN_POSTERS: "/admin/posters",

  // Organization Panel
  ORGANIZATION_PANEL: "/organization-panel",
  ORGANIZATION_PANEL_POSTERS: "/organization-panel/posters",
  ORGANIZATION_PANEL_INTEGRATIONS: "/organization-panel/integrations",
  ORGANIZATION_PANEL_MEMBERS: "/organization-panel/members",
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
  "admin-organizations": ROUTES.ADMIN_ORGANIZATIONS,
  "admin-posters": ROUTES.ADMIN_POSTERS,
} as const;

export type AdminRouteKey = keyof typeof ADMIN_ROUTE_MAP;

// ── Organization Panel sub-route map ───────────────────────────────────────
export const ORGANIZATION_PANEL_ROUTE_MAP = {
  "organization-panel-posters": ROUTES.ORGANIZATION_PANEL_POSTERS,
  "organization-panel-integrations": ROUTES.ORGANIZATION_PANEL_INTEGRATIONS,
  "organization-panel-members": ROUTES.ORGANIZATION_PANEL_MEMBERS,
} as const;

export type OrganizationPanelRouteKey = keyof typeof ORGANIZATION_PANEL_ROUTE_MAP;
