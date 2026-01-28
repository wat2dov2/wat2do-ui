/**
 * Admin Feature
 * Public API for admin functionality
 */

// API
export * from "./api/admin.api";

// Context
export { AdminProvider, useAdminContext } from "./context/AdminContext";

// Pages
export { AdminPanel } from "./pages/AdminPanel";
export { AdminEventsPage } from "./pages/AdminEventsPage";
export { AdminClubsPage } from "./pages/AdminClubsPage";
export { AdminSubmissionsPage } from "./pages/AdminSubmissionsPage";
export { AdminPostersPage } from "./pages/AdminPostersPage";

// Shared Components
export { AdminDeleteDialog } from "./components/shared/AdminDeleteDialog";
export { AdminTable } from "./components/shared/AdminTable";
export { AdminCard } from "./components/shared/AdminCard";

// Utils
export { submissionToEventData } from "./utils/submissionToEvent";

// Hooks (internal - typically not exported, but available if needed)
export { useAdminSubmissionsFilters } from "./hooks/useAdminSubmissionsFilters";
export { useAdminSubmissionsPagination } from "./hooks/useAdminSubmissionsPagination";
export { useAdminSubmissionsActions } from "./hooks/useAdminSubmissionsActions";
export { useAdminPostersFilters } from "./hooks/useAdminPostersFilters";
export { useAdminPostersPagination } from "./hooks/useAdminPostersPagination";
export { useAdminPostersStats } from "./hooks/useAdminPostersStats";
