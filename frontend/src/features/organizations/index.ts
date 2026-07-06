/**
 * Organizations Feature
 * Main export point for organizations feature
 */

// Components
export { AddOrganizationModal } from "./components/AddOrganizationModal";
export { OrganizationBadgeDropdown } from "./components/OrganizationBadgeDropdown";

// API
export {
  getAllOrganizations,
  getOrganizationByName,
  getMyOrganizations,
  createOrganizationAPI,
  updateOrganizationAPI,
  deleteOrganizationAPI,
  filterOrganizations,
} from "./api/organizations.api";

// Hooks
export { useOrganizationNameLookup } from "./hooks/useOrganizationNameLookup";
