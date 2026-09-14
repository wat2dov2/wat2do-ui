"use client";

/**
 * Admin route handlers.
 *
 * Heavy admin page components are lazy-loaded so they are split into a
 * separate chunk that only admin users ever download.
 */

import { lazy, Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, ADMIN_ROUTE_MAP, type AdminRouteKey } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

const AdminPanel = lazy(() =>
  import("@/features/admin/pages/AdminPanel").then((m) => ({ default: m.AdminPanel }))
);
const AdminEventsPage = lazy(() =>
  import("@/features/admin/pages/AdminEventsPage").then((m) => ({ default: m.AdminEventsPage }))
);
const AdminPositionsPage = lazy(() =>
  import("@/features/admin/pages/AdminPositionsPage").then((m) => ({ default: m.AdminPositionsPage }))
);
const AdminClubsPage = lazy(() =>
  import("@/features/admin/pages/AdminClubsPage").then((m) => ({ default: m.AdminClubsPage }))
);
const AdminPostersPage = lazy(() =>
  import("@/features/admin/pages/AdminPostersPage").then((m) => ({
    default: m.AdminPostersPage,
  }))
);
const AdminInstagramPage = lazy(() =>
  import("@/features/admin/pages/AdminInstagramPage").then((m) => ({
    default: m.AdminInstagramPage,
  }))
);
const AdminDiagnosticsPage = lazy(() =>
  import("@/features/admin/pages/AdminDiagnosticsPage").then((m) => ({
    default: m.AdminDiagnosticsPage,
  }))
);

function useAdminNavigation() {
  const router = useRouter();

  return useCallback(
    (page: AdminRouteKey) => {
      router.push(ADMIN_ROUTE_MAP[page]);
    },
    [router]
  );
}

function AdminSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

export function AdminPanelRoute() {
  const handleNavigate = useAdminNavigation();

  return (
    <AdminSuspense>
      <AdminPanel onNavigate={handleNavigate} />
    </AdminSuspense>
  );
}

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

export function AdminClubsRoute() {
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);

  return (
    <AdminSuspense>
      <AdminClubsPage
        onBack={onBack}
      />
    </AdminSuspense>
  );
}

export function AdminPositionsRoute() {
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);
  return <AdminSuspense><AdminPositionsPage onBack={onBack} /></AdminSuspense>;
}

export function AdminPostersRoute() {
  return (
    <AdminSuspense>
      <AdminPostersPage />
    </AdminSuspense>
  );
}

export function AdminInstagramRoute() {
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);

  return (
    <AdminSuspense>
      <AdminInstagramPage onBack={onBack} />
    </AdminSuspense>
  );
}

export function AdminDiagnosticsRoute() {
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);

  return (
    <AdminSuspense>
      <AdminDiagnosticsPage onBack={onBack} />
    </AdminSuspense>
  );
}
