/**
 * Centralized route path definitions.
 *
 * Every client-side route string used in router navigation or pathname
 * comparisons should reference this object instead of using a raw string.
 *
 * Sub-route maps (ADMIN_ROUTE_MAP, CLUB_PANEL_ROUTE_MAP) are also derived from these
 * constants so there is a single source of truth.
 */

import { QP } from "@/shared/constants/queryParams";

// ── Top-level routes ───────────────────────────────────────────────
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  AUTH_CALLBACK: "/auth/callback",
  ONBOARDING: "/onboarding",
  ONBOARDING_DEMO: "/onboarding-demo",
  CONTACT: "/contact",
  CLUBS: "/clubs",
  POSITIONS: "/positions",
  CLUB_CREATE: "/clubs/new",
  SETTINGS: "/settings",
  MARKETING: "/marketing",
  INVITE: "/invite",
  EVENT_SUBMIT: "/events/submit",
  POSITION_SUBMIT: "/positions/submit",
  PROMOTE: "/promote",
  POSTERS: "/posters",

  // Admin
  ADMIN: "/admin",
  ADMIN_EVENTS: "/admin/events",
  ADMIN_POSITIONS: "/admin/positions",
  ADMIN_CLUBS: "/admin/clubs",
  ADMIN_POSTERS: "/admin/posters",
  ADMIN_INSTAGRAM: "/admin/instagram",
  ADMIN_DIAGNOSTICS: "/admin/diagnostics",

  // Club Panel
  CLUB_PANEL: "/club-panel",
  CLUB_PANEL_POSTERS: "/club-panel/posters",
  CLUB_PANEL_INTEGRATIONS: "/club-panel/integrations",
  CLUB_PANEL_MEMBERS: "/club-panel/members",
} as const;

export function clubPagePath(clubId: number): string {
  return `${ROUTES.CLUBS}/${clubId}`;
}

const APP_NAME = "Wat2Do";

const ROUTE_PAGE_TITLES: Partial<
  Record<(typeof ROUTES)[keyof typeof ROUTES], string>
> = {
  [ROUTES.HOME]: "Campus Events",
  [ROUTES.LOGIN]: "Sign In",
  [ROUTES.AUTH_CALLBACK]: "Signing In",
  [ROUTES.ONBOARDING]: "Onboarding",
  [ROUTES.ONBOARDING_DEMO]: "Onboarding Demo",
  [ROUTES.CONTACT]: "Contact",
  [ROUTES.CLUBS]: "Clubs",
  [ROUTES.POSITIONS]: "Positions",
  [ROUTES.CLUB_CREATE]: "Add a Club",
  [ROUTES.SETTINGS]: "Settings",
  [ROUTES.MARKETING]: "Marketing",
  [ROUTES.EVENT_SUBMIT]: "Submit an Event",
  [ROUTES.PROMOTE]: "Promote Events",
  [ROUTES.POSTERS]: "My Posters",
  [ROUTES.ADMIN]: "Admin",
  [ROUTES.ADMIN_EVENTS]: "Admin Events",
  [ROUTES.ADMIN_POSITIONS]: "Admin Positions",
  [ROUTES.ADMIN_CLUBS]: "Admin Clubs",
  [ROUTES.ADMIN_POSTERS]: "Admin Posters",
  [ROUTES.ADMIN_INSTAGRAM]: "Instagram Publishing",
  [ROUTES.ADMIN_DIAGNOSTICS]: "App Diagnostics",
  [ROUTES.CLUB_PANEL]: "Club Panel",
  [ROUTES.CLUB_PANEL_POSTERS]: "Posters",
  [ROUTES.CLUB_PANEL_INTEGRATIONS]: "Integrations",
  [ROUTES.CLUB_PANEL_MEMBERS]: "Members",
};

function buildDocumentTitle(pageTitle?: string): string {
  return pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME;
}

export function getRouteDocumentTitle(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/+$/, "") || ROUTES.HOME;

  if (normalizedPathname.startsWith("/invite/")) {
    return buildDocumentTitle("Club Invite");
  }

  if (
    normalizedPathname !== ROUTES.CLUB_CREATE &&
    normalizedPathname.startsWith(`${ROUTES.CLUBS}/`)
  ) {
    return buildDocumentTitle("Club");
  }

  if (normalizedPathname.startsWith("/qr/")) {
    return buildDocumentTitle("QR Redirect");
  }

  return buildDocumentTitle(
    ROUTE_PAGE_TITLES[normalizedPathname as keyof typeof ROUTE_PAGE_TITLES],
  );
}

// ── Settings sub-tabs (used as query params: /settings?tab=<tab>) ──
export const SETTINGS_TABS = {
  PROFILE: "profile",
  NOTIFICATIONS: "notifications",
  APPEARANCE: "appearance",
  PROMOTER: "promoter",
} as const;

/** Build a settings URL with a specific tab selected. */
export function settingsTabPath(
  tab: (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS],
): string {
  return `${ROUTES.SETTINGS}?${QP.TAB}=${tab}`;
}

// ── Admin sub-route map ────────────────────────────────────────────
export const ADMIN_ROUTE_MAP = {
  "admin-events": ROUTES.ADMIN_EVENTS,
  "admin-positions": ROUTES.ADMIN_POSITIONS,
  "admin-clubs": ROUTES.ADMIN_CLUBS,
  "admin-posters": ROUTES.ADMIN_POSTERS,
  "admin-instagram": ROUTES.ADMIN_INSTAGRAM,
  "admin-diagnostics": ROUTES.ADMIN_DIAGNOSTICS,
} as const;

export type AdminRouteKey = keyof typeof ADMIN_ROUTE_MAP;

// ── Club Panel sub-route map ───────────────────────────────────────
export const CLUB_PANEL_ROUTE_MAP = {
  "club-panel-posters": ROUTES.CLUB_PANEL_POSTERS,
  "club-panel-integrations": ROUTES.CLUB_PANEL_INTEGRATIONS,
  "club-panel-members": ROUTES.CLUB_PANEL_MEMBERS,
} as const;

export type ClubPanelRouteKey =
  keyof typeof CLUB_PANEL_ROUTE_MAP;
