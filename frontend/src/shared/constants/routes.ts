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
  LANDING: "/landing",
  EVENTS: "/events",
  LOGIN: "/login",
  AUTH_CALLBACK: "/auth/callback",
  /** The last page of a sign-in that ran in a window of its own. */
  AUTH_SIGNED_IN: "/auth/signed-in",
  ONBOARDING: "/onboarding",
  ONBOARDING_DEMO: "/onboarding-demo",
  ABOUT: "/about",
  SUPPORT_LOCAL: "/support-local",
  CLUBS: "/clubs",
  POSITIONS: "/positions",
  CLUB_CREATE: "/clubs/new",
  PROFILE: "/profile",
  MARKETING: "/marketing",
  INVITE: "/invite",
  CLAIM: "/claim",
  EVENT_SUBMIT: "/events/submit",
  POSITION_SUBMIT: "/positions/submit",
  PROMOTE: "/promote",
  POSTERS: "/posters",
  /** A poster's QR code: records the scan, then opens the poster's destination. */
  QR: "/qr",
  DATA_POLICY: "/data-policy",
  CLUB_PAYOUT_TERMS: "/club-payout-terms",

  // Admin
  ADMIN: "/admin",
  ADMIN_EVENTS: "/admin/events",
  ADMIN_SPONSORS: "/admin/sponsors",
  ADMIN_PAIN_POINTS: "/admin/pain-points",
  ADMIN_OUTREACH: "/admin/outreach",
  ADMIN_POSITIONS: "/admin/positions",
  ADMIN_CLUBS: "/admin/clubs",
  ADMIN_POSTERS: "/admin/posters",
  ADMIN_INSTAGRAM: "/admin/instagram",
  ADMIN_SOCIAL: "/admin/social",
  ADMIN_DIAGNOSTICS: "/admin/diagnostics",

  // Club Panel
  CLUB_PANEL: "/club-panel",
  CLUB_PANEL_EVENTS: "/club-panel/events",
  CLUB_PANEL_POSITIONS: "/club-panel/positions",
  CLUB_PANEL_MEMBERS: "/club-panel/members",
  CLUB_PANEL_PAYOUTS: "/club-panel/payouts",

  // Tickets
  TICKETS: "/tickets",
} as const;

/** Only plain public URLs are eligible for full-page navigation warming. */
export const PUBLIC_PAGE_ROUTES: readonly string[] = [
  ROUTES.EVENTS,
  ROUTES.POSITIONS,
  ROUTES.CLUBS,
  ROUTES.ABOUT,
  ROUTES.SUPPORT_LOCAL,
  ROUTES.LOGIN,
];

export function clubPagePath(clubId: number): string {
  return `${ROUTES.CLUBS}/${clubId}`;
}

/** A club's page opened on its Positions tab, where its approved positions are listed. */
export function clubPositionsPath(clubId: number): string {
  return `${clubPagePath(clubId)}?${QP.TAB}=positions`;
}

/** One ticket's page: its holder's QR code, and check-in for the club's team. */
export function ticketPath(code: string): string {
  return `${ROUTES.TICKETS}/${code}`;
}

/** Where Stripe Checkout returns a buyer while their payment is confirmed. */
export function ticketOrderPath(orderId: string): string {
  return `${ROUTES.TICKETS}/orders/${orderId}`;
}

/** A club's ticket desk for one event: turning tickets on, the door list and refunds. */
export function clubPanelEventTicketsPath(eventId: number): string {
  return `${ROUTES.CLUB_PANEL_EVENTS}/${eventId}`;
}

export function clubPanelDoorScannerPath(eventId: number): string {
  return `${clubPanelEventTicketsPath(eventId)}/scan`;
}

const APP_NAME = "Wat2Do";

const ROUTE_PAGE_TITLES: Partial<
  Record<(typeof ROUTES)[keyof typeof ROUTES], string>
> = {
  [ROUTES.EVENTS]: "Campus Events",
  [ROUTES.LOGIN]: "Sign In",
  [ROUTES.AUTH_CALLBACK]: "Signing In",
  [ROUTES.AUTH_SIGNED_IN]: "Signed In",
  [ROUTES.ONBOARDING]: "Onboarding",
  [ROUTES.ONBOARDING_DEMO]: "Onboarding Demo",
  [ROUTES.ABOUT]: "About",
  [ROUTES.SUPPORT_LOCAL]: "Support a Local Business",
  [ROUTES.CLUBS]: "Clubs",
  [ROUTES.POSITIONS]: "Positions",
  [ROUTES.CLUB_CREATE]: "Add a Club",
  [ROUTES.PROFILE]: "Profile",
  [ROUTES.MARKETING]: "Marketing",
  [ROUTES.EVENT_SUBMIT]: "Submit an Event",
  [ROUTES.PROMOTE]: "Promote Events",
  [ROUTES.POSTERS]: "My Posters",
  [ROUTES.DATA_POLICY]: "Data Policy",
  [ROUTES.CLUB_PAYOUT_TERMS]: "Club Payout Terms",
  [ROUTES.ADMIN]: "Admin",
  [ROUTES.ADMIN_EVENTS]: "Admin Events",
  [ROUTES.ADMIN_POSITIONS]: "Admin Positions",
  [ROUTES.ADMIN_CLUBS]: "Admin Clubs",
  [ROUTES.ADMIN_POSTERS]: "Admin Posters",
  [ROUTES.ADMIN_INSTAGRAM]: "Instagram Publishing",
  [ROUTES.ADMIN_SOCIAL]: "Social Accounts",
  [ROUTES.ADMIN_DIAGNOSTICS]: "App Diagnostics",
  [ROUTES.CLUB_PANEL]: "Club Panel",
  [ROUTES.CLUB_PANEL_EVENTS]: "Club Events",
  [ROUTES.CLUB_PANEL_POSITIONS]: "Club Positions",
  [ROUTES.CLUB_PANEL_MEMBERS]: "Members",
  [ROUTES.CLUB_PANEL_PAYOUTS]: "Payouts",
  [ROUTES.TICKETS]: "My Tickets",
};

function buildDocumentTitle(pageTitle?: string): string {
  return pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME;
}

export function getRouteDocumentTitle(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";

  if (normalizedPathname.startsWith("/invite/")) {
    return buildDocumentTitle("Club Invite");
  }

  if (normalizedPathname.startsWith(`${ROUTES.CLAIM}/`)) {
    return buildDocumentTitle("Claim Club");
  }

  if (
    normalizedPathname !== ROUTES.CLUB_CREATE &&
    normalizedPathname.startsWith(`${ROUTES.CLUBS}/`)
  ) {
    return buildDocumentTitle("Club");
  }

  if (normalizedPathname.startsWith(`${ROUTES.TICKETS}/`)) {
    return buildDocumentTitle("Ticket");
  }

  if (normalizedPathname.startsWith(`${ROUTES.CLUB_PANEL_EVENTS}/`)) {
    return buildDocumentTitle("Tickets");
  }

  if (normalizedPathname.startsWith(`${ROUTES.QR}/`)) {
    return buildDocumentTitle("QR Redirect");
  }

  return buildDocumentTitle(
    ROUTE_PAGE_TITLES[normalizedPathname as keyof typeof ROUTE_PAGE_TITLES],
  );
}

// ── The profile page's tabs (used as query params: /profile?tab=<tab>) ──
export const PROFILE_TABS = {
  EVENTS: "events",
  CLUBS: "clubs",
  POSITIONS: "positions",
  SETTINGS: "settings",
} as const;

export type ProfileTab = (typeof PROFILE_TABS)[keyof typeof PROFILE_TABS];

// ── Settings sub-tabs, inside the profile's Settings tab. A link to one opens the profile on Settings with it selected. ──
export const SETTINGS_TABS = {
  PROFILE: "profile",
  NOTIFICATIONS: "notifications",
  APPEARANCE: "appearance",
  PROMOTER: "promoter",
} as const;

export type SettingsTab = (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS];

/** The profile page opened on one of its tabs, or on Settings with one settings tab selected. */
export function profileTabPath(tab: ProfileTab | SettingsTab): string {
  return `${ROUTES.PROFILE}?${QP.TAB}=${tab}`;
}

// ── Admin sub-route map ────────────────────────────────────────────
export const ADMIN_ROUTE_MAP = {
  "admin-events": ROUTES.ADMIN_EVENTS,
  "admin-sponsors": ROUTES.ADMIN_SPONSORS,
  "admin-pain-points": ROUTES.ADMIN_PAIN_POINTS,
  "admin-outreach": ROUTES.ADMIN_OUTREACH,
  "admin-positions": ROUTES.ADMIN_POSITIONS,
  "admin-clubs": ROUTES.ADMIN_CLUBS,
  "admin-posters": ROUTES.ADMIN_POSTERS,
  "admin-instagram": ROUTES.ADMIN_INSTAGRAM,
  "admin-social": ROUTES.ADMIN_SOCIAL,
  "admin-diagnostics": ROUTES.ADMIN_DIAGNOSTICS,
} as const;

export type AdminRouteKey = keyof typeof ADMIN_ROUTE_MAP;

// ── Club Panel sub-route map ───────────────────────────────────────
export const CLUB_PANEL_ROUTE_MAP = {
  "club-panel-events": ROUTES.CLUB_PANEL_EVENTS,
  "club-panel-positions": ROUTES.CLUB_PANEL_POSITIONS,
  "club-panel-members": ROUTES.CLUB_PANEL_MEMBERS,
  "club-panel-payouts": ROUTES.CLUB_PANEL_PAYOUTS,
} as const;

export type ClubPanelRouteKey =
  keyof typeof CLUB_PANEL_ROUTE_MAP;
