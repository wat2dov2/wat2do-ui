/**
 * Admin Routes Configuration
 * Centralized admin route handlers and props to reduce duplication.
 *
 * Heavy admin page components are lazy-loaded so they are split into a
 * separate chunk that only admin users ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, ADMIN_ROUTE_MAP, type AdminRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

// Lazy-loaded admin page components — only fetched when an admin route renders.
const AdminPanel = lazy(() =>
  import("@/features/admin/pages/AdminPanel").then((m) => ({ default: m.AdminPanel }))
);
const AdminEventsPage = lazy(() =>
  import("@/features/admin/pages/AdminEventsPage").then((m) => ({ default: m.AdminEventsPage }))
);
const AdminOrganizationsPage = lazy(() =>
  import("@/features/admin/pages/AdminOrganizationsPage").then((m) => ({ default: m.AdminOrganizationsPage }))
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
  const router = useRouter();

  return useCallback(
    (page: AdminRouteKey) => {
      router.push(ADMIN_ROUTE_MAP[page]);
    },
    [router]
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
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);

  return (
    <AdminSuspense>
      <AdminEventsPage
        onBack={onBack}
      />
    </AdminSuspense>
  );
}

/**
 * Admin Organizations Route Component
 */
export function AdminOrganizationsRoute() {
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);

  return (
    <AdminSuspense>
      <AdminOrganizationsPage
        onBack={onBack}
      />
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
