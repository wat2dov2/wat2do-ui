/**
 * Clubs Feature
 * Main export point for clubs feature
 * 
 * Architecture:
 * - pages/ - Page components
 * - components/ - Feature-specific UI components
 * - api/ - API layer for data operations
 */

// Pages
export { ClubsPage } from "./pages/ClubsPage";

// Components
export { AddClubModal } from "./components/AddClubModal";

// API
export {
  getAllClubs,
  createClubAPI,
  updateClubAPI,
  deleteClubAPI,
  filterClubs,
  getClubTypes,
  loadClubsData,
} from "./api/clubs.api";
