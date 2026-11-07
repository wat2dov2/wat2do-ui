import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  Coins,
  Instagram,
  Mail,
  Megaphone,
  MessageCircle,
  Settings,
  Shield,
  Ticket,
  Users,
} from "lucide-react";
import type { ContainerSize } from "@/shared/layout/container";
import { ROUTES } from "@/shared/constants/routes";

/** The shape of a page's body, which its loading state mirrors. */
export type PageShellBody = "dashboard" | "list" | "sections" | "rows" | "form" | "upload";

/**
 * What a page looks like before its data arrives: the header it always shows
 * and the shape of its body.
 *
 * Each page renders its header from this entry, and the route's loading state
 * renders the same header with a skeleton of the same body, so the two cannot
 * drift apart. A page whose title depends on its data (a club's name) still
 * names a fallback here for the moment before that data exists.
 */
export interface PageShell {
  icon?: LucideIcon;
  titleKey: string;
  descriptionKey?: string;
  back?: "admin" | "clubPanel" | "events" | "positions" | "clubs";
  /** The width of the page and of its loading state. */
  container: ContainerSize;
  /** How many tabs sit between the header and the body. */
  tabs?: number;
  /** How many cards a dashboard body shows. */
  cards?: number;
  body: PageShellBody;
}

export const PAGE_SHELLS: Readonly<Record<string, PageShell>> = {
  [ROUTES.ADMIN]: { icon: Shield, titleKey: "navigation.adminPanel", descriptionKey: "admin.panelDescription", cards: 9, container: "lg", body: "dashboard" },
  [ROUTES.ADMIN_EVENTS]: { icon: Calendar, titleKey: "admin.manageEvents", descriptionKey: "admin.manageEventsDesc", back: "admin", tabs: 3, container: "lg", body: "list" },
  [ROUTES.ADMIN_CLUBS]: { icon: Building2, titleKey: "admin.manageClubs", descriptionKey: "admin.manageClubsDesc", back: "admin", tabs: 4, container: "lg", body: "list" },
  [ROUTES.ADMIN_POSITIONS]: { icon: Users, titleKey: "navigation.positions", descriptionKey: "positions.searchPlaceholder", back: "admin", tabs: 2, container: "lg", body: "list" },
  [ROUTES.ADMIN_POSTERS]: { icon: Megaphone, titleKey: "admin.qrAssets.title", descriptionKey: "admin.qrAssets.description", back: "admin", tabs: 2, container: "lg", body: "list" },
  [ROUTES.ADMIN_INSTAGRAM]: { icon: Instagram, titleKey: "admin.instagramPublishing.title", descriptionKey: "admin.instagramPublishing.description", back: "admin", container: "lg", tabs: 2, body: "list" },
  [ROUTES.ADMIN_SOCIAL]: { icon: BarChart3, titleKey: "admin.socialAccounts.title", descriptionKey: "admin.socialAccounts.description", back: "admin", container: "lg", body: "dashboard" },
  [ROUTES.ADMIN_DIAGNOSTICS]: { icon: Settings, titleKey: "admin.diagnostics.title", descriptionKey: "admin.diagnostics.description", back: "admin", container: "lg", tabs: 5, body: "list" },
  [ROUTES.ADMIN_SPONSORS]: { icon: Building2, titleKey: "admin.sponsors.title", descriptionKey: "admin.sponsors.description", back: "admin", container: "lg", body: "list" },
  [ROUTES.ADMIN_PAIN_POINTS]: { icon: MessageCircle, titleKey: "admin.painPoints.title", descriptionKey: "admin.painPoints.description", back: "admin", tabs: 3, container: "lg", body: "list" },
  [ROUTES.ADMIN_OUTREACH]: { icon: Mail, titleKey: "admin.outreach.title", descriptionKey: "admin.outreach.description", back: "admin", container: "lg", body: "list" },
  [ROUTES.CLUB_PANEL]: { icon: Building2, titleKey: "clubPanel.title", descriptionKey: "clubPanel.description", cards: 3, container: "lg", body: "dashboard" },
  [ROUTES.CLUB_PANEL_EVENTS]: { icon: Calendar, titleKey: "navigation.events", descriptionKey: "clubPanel.eventsDesc", back: "clubPanel", container: "lg", body: "list" },
  [ROUTES.CLUB_PANEL_POSITIONS]: { icon: Briefcase, titleKey: "navigation.positions", descriptionKey: "clubPanel.positionsDesc", back: "clubPanel", container: "lg", body: "list" },
  [ROUTES.CLUB_PANEL_MEMBERS]: { icon: Users, titleKey: "clubPanel.members", descriptionKey: "clubPanel.membersDesc", back: "clubPanel", container: "lg", body: "list" },
  [ROUTES.CLUB_PANEL_PAYOUTS]: { icon: Coins, titleKey: "clubPanel.payouts.title", descriptionKey: "clubPanel.payoutsDesc", back: "clubPanel", container: "md", body: "sections" },
  [ROUTES.SETTINGS]: { titleKey: "navigation.settings", descriptionKey: "settings.description", container: "md", tabs: 3, body: "sections" },
  [ROUTES.TICKETS]: { icon: Ticket, titleKey: "tickets.title", descriptionKey: "tickets.description", container: "md", body: "rows" },
  [ROUTES.POSTERS]: { titleKey: "posters.dashboard.title", container: "sm", body: "sections" },
  [ROUTES.EVENT_SUBMIT]: { titleKey: "events.createEvent", back: "events", container: "sm", body: "upload" },
  [ROUTES.POSITION_SUBMIT]: { titleKey: "positions.addPosition", back: "positions", container: "sm", body: "upload" },
  [ROUTES.CLUB_CREATE]: { titleKey: "clubs.submitClub", back: "clubs", container: "md", body: "form" },
};
