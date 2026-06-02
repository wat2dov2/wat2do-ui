/**
 * Admin Routes Configuration
 * Centralized admin route handlers and props to reduce duplication.
 *
 * Heavy admin page components are lazy-loaded so they are split into a
 * separate chunk that only admin users ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES, ADMIN_ROUTE_MAP, type AdminRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

// Lazy-loaded admin page components — only fetched when an admin route renders.
const AdminPanel = lazy(() =>
  import("@/features/admin/pages/AdminPanel").then((m) => ({ default: m.AdminPanel }))
);
const AdminEventsPage = lazy(() =>
  import("@/features/admin/pages/AdminEventsPage").then((m) => ({ default: m.AdminEventsPage }))
);
const AdminClubsPage = lazy(() =>
  import("@/features/admin/pages/AdminClubsPage").then((m) => ({ default: m.AdminClubsPage }))
);
const AdminSubmissionsPage = lazy(() =>
  import("@/features/admin/pages/AdminSubmissionsPage").then((m) => ({
    default: m.AdminSubmissionsPage,
  }))
);
const AdminPostersPage = lazy(() =>
  import("@/features/admin/pages/AdminPostersPage").then((m) => ({
    default: m.AdminPostersPage,
  }))
);

/**
 * Admin panel navigation handler
 */
function useAdminNavigation() {
  const navigate = useNavigate();

  return useCallback(
    (page: AdminRouteKey) => {
      navigate(ADMIN_ROUTE_MAP[page]);
    },
    [navigate]
  );
}

/** Suspense wrapper for lazy-loaded admin pages. */
function AdminSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

/**
 * Admin Panel Route Component
 */
export function AdminPanelRoute() {
  const handleNavigate = useAdminNavigation();

  return (
    <AdminSuspense>
      <AdminPanel onNavigate={handleNavigate} />
    </AdminSuspense>
  );
}

/**
 * Admin Events Route Component
 */
export function AdminEventsRoute() {
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate(ROUTES.ADMIN), [navigate]);

  return (
    <AdminSuspense>
      <AdminEventsPage
        onBack={onBack}
      />
    </AdminSuspense>
  );
}

/**
 * Admin Clubs Route Component
 */
export function AdminClubsRoute() {
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate(ROUTES.ADMIN), [navigate]);

  return (
    <AdminSuspense>
      <AdminClubsPage
        onBack={onBack}
      />
    </AdminSuspense>
  );
}

export function AdminSubmissionsRoute() {
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate(ROUTES.ADMIN), [navigate]);

  return (
    <AdminSuspense>
      <AdminSubmissionsPage onBack={onBack} />
    </AdminSuspense>
  );
}

/**
 * Admin Posters Route Component
 */
export function AdminPostersRoute() {
  return (
    <AdminSuspense>
      <AdminPostersPage />
    </AdminSuspense>
  );
}
