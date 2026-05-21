/**
 * Admin Feature
 * Public API for admin functionality
 */

// API
export * from "./api/admin.api";

// Store
export { useAdminStore } from "./store/admin.store";

// Pages
export { AdminPanel } from "./pages/AdminPanel";
export { AdminEventsPage } from "./pages/AdminEventsPage";
export { AdminClubsPage } from "./pages/AdminClubsPage";
export { AdminPostersPage } from "./pages/AdminPostersPage";

// Shared Components
export { AdminDeleteDialog } from "./components/shared/AdminDeleteDialog";
export { AdminTable } from "./components/shared/AdminTable";
export { AdminCard } from "./components/shared/AdminCard";

// Hooks (internal - typically not exported, but available if needed)
export { useAdminPostersFilters } from "./hooks/useAdminPostersFilters";
export { useAdminPostersPagination } from "./hooks/useAdminPostersPagination";
export { useAdminPostersStats } from "./hooks/useAdminPostersStats";
