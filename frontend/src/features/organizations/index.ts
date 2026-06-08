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
export { OrganizationsPage } from "./pages/OrganizationsPage";

// Components
export { AddOrganizationModal } from "./components/AddOrganizationModal";

// API
export {
  getAllClubs,
  getMyClubs,
  createOrganizationAPI,
  updateOrganizationAPI,
  deleteOrganizationAPI,
  filterOrganizations,
  getOrganizationTypes,
  loadOrganizationsData,
} from "./api/organizations.api";

// Hooks
export { useOrganizationNameLookup } from "./hooks/useOrganizationNameLookup";
