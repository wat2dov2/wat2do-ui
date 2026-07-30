/**
 * Centralized route path definitions.
 *
 * Every client-side route string used in router navigation or pathname
 * comparisons should reference this object instead of using a raw string.
 *
 * Sub-route maps (ADMIN_ROUTE_MAP, ORGANIZATION_PANEL_ROUTE_MAP) are also derived from these
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
  ORGANIZATIONS: "/organizations",
  ORGANIZATION_CREATE: "/organizations/new",
  SETTINGS: "/settings",
  MARKETING: "/marketing",
  INVITE: "/invite",
  EVENT_SUBMIT: "/events/submit",
  PROMOTE: "/promote",
  POSTERS: "/posters",

  // Admin
  ADMIN: "/admin",
  ADMIN_EVENTS: "/admin/events",
  ADMIN_ORGANIZATIONS: "/admin/organizations",
  ADMIN_POSTERS: "/admin/posters",
  ADMIN_INSTAGRAM: "/admin/instagram",
  ADMIN_DIAGNOSTICS: "/admin/diagnostics",

  // Organization Panel
  ORGANIZATION_PANEL: "/organization-panel",
  ORGANIZATION_PANEL_POSTERS: "/organization-panel/posters",
  ORGANIZATION_PANEL_INTEGRATIONS: "/organization-panel/integrations",
  ORGANIZATION_PANEL_MEMBERS: "/organization-panel/members",
} as const;

export function organizationPagePath(organizationId: number): string {
  return `${ROUTES.ORGANIZATIONS}/${organizationId}`;
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
  [ROUTES.ORGANIZATIONS]: "Organizations",
  [ROUTES.ORGANIZATION_CREATE]: "Add an Organization",
  [ROUTES.SETTINGS]: "Settings",
  [ROUTES.MARKETING]: "Marketing",
  [ROUTES.EVENT_SUBMIT]: "Submit an Event",
  [ROUTES.PROMOTE]: "Promote Events",
  [ROUTES.POSTERS]: "My Posters",
  [ROUTES.ADMIN]: "Admin",
  [ROUTES.ADMIN_EVENTS]: "Admin Events",
  [ROUTES.ADMIN_ORGANIZATIONS]: "Admin Organizations",
  [ROUTES.ADMIN_POSTERS]: "Admin Posters",
  [ROUTES.ADMIN_INSTAGRAM]: "Instagram Publishing",
  [ROUTES.ADMIN_DIAGNOSTICS]: "App Diagnostics",
  [ROUTES.ORGANIZATION_PANEL]: "Organization Panel",
  [ROUTES.ORGANIZATION_PANEL_POSTERS]: "Posters",
  [ROUTES.ORGANIZATION_PANEL_INTEGRATIONS]: "Integrations",
  [ROUTES.ORGANIZATION_PANEL_MEMBERS]: "Members",
};

function buildDocumentTitle(pageTitle?: string): string {
  return pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME;
}

export function getRouteDocumentTitle(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/+$/, "") || ROUTES.HOME;

  if (normalizedPathname.startsWith("/invite/")) {
    return buildDocumentTitle("Organization Invite");
  }

  if (
    normalizedPathname !== ROUTES.ORGANIZATION_CREATE &&
    normalizedPathname.startsWith(`${ROUTES.ORGANIZATIONS}/`)
  ) {
    return buildDocumentTitle("Organization");
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
  "admin-organizations": ROUTES.ADMIN_ORGANIZATIONS,
  "admin-posters": ROUTES.ADMIN_POSTERS,
  "admin-instagram": ROUTES.ADMIN_INSTAGRAM,
  "admin-diagnostics": ROUTES.ADMIN_DIAGNOSTICS,
} as const;

export type AdminRouteKey = keyof typeof ADMIN_ROUTE_MAP;

// ── Organization Panel sub-route map ───────────────────────────────────────
export const ORGANIZATION_PANEL_ROUTE_MAP = {
  "organization-panel-posters": ROUTES.ORGANIZATION_PANEL_POSTERS,
  "organization-panel-integrations": ROUTES.ORGANIZATION_PANEL_INTEGRATIONS,
  "organization-panel-members": ROUTES.ORGANIZATION_PANEL_MEMBERS,
} as const;

export type OrganizationPanelRouteKey =
  keyof typeof ORGANIZATION_PANEL_ROUTE_MAP;
