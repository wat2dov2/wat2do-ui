import type { PageMode } from "@/shared/types";
import { ROUTES } from "@/shared/constants/routes";

/**
 * Derive PageMode from a pathname.
 * Single source of truth for route-to-PageMode mapping.
 */
export function derivePageMode(pathname: string): PageMode {
  if (pathname === ROUTES.CLUBS) return "clubs";
  if (pathname === ROUTES.ABOUT) return "about";
  if (pathname === ROUTES.SETTINGS) return "settings";
  if (pathname.startsWith(ROUTES.ADMIN_EVENTS)) return "admin-events";
  if (pathname.startsWith(ROUTES.ADMIN_CLUBS)) return "admin-clubs";
  if (pathname.startsWith(ROUTES.ADMIN_POSTERS)) return "admin-posters";
  if (pathname.startsWith(ROUTES.ADMIN)) return "admin";
  if (pathname === ROUTES.MARKETING) return "marketing";
  return "events";
}
