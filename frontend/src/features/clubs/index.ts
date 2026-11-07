/**
 * Clubs Feature
 * Main export point for clubs feature
 */

// Components
export { ClubInput } from "./components/ClubInput";
export { AddClubModal } from "./components/AddClubModal";
export { ClubBadgeLink } from "./components/ClubBadgeLink";

// API
export {
  clubDirectoryQueryOptions,
  getMyClubs,
  getClubById,
  createClubAPI,
  updateClubAPI,
  deleteClubAPI,
} from "./api/clubs.api";

// Hooks
export { useOpenClubPanel } from "./hooks/useOpenClubPanel";
export { useActiveClub, useOwnClub } from "./hooks/useActiveClub";

// The club panel's school site
export { CLUB_PANEL_CLUB_PARAM, clubPanelUrlElsewhere, makeActiveClub } from "./lib/clubPanelSite";
