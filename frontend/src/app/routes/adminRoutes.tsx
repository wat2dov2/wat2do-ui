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
import { ADMIN_ROUTE_MAP, type AdminRouteKey } from "@/shared/constants/routes";
import { RouteLoading } from "@/app/routes/RouteLoading";

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

const AdminCompetitorPainPointsPage = lazy(() =>
  import("@/features/admin/pages/AdminCompetitorPainPointsPage").then(m => ({ default: m.AdminCompetitorPainPointsPage }))
);
const AdminOutreachPage = lazy(() =>
  import("@/features/admin/pages/AdminOutreachPage").then(m => ({ default: m.AdminOutreachPage }))
);
const AdminSocialAccountsPage = lazy(() =>
  import("@/features/admin/pages/AdminSocialAccountsPage").then(m => ({ default: m.AdminSocialAccountsPage }))
);
const AdminSponsorsPage = lazy(() =>
  import("@/features/admin/pages/AdminSponsorsPage").then(m => ({ default: m.AdminSponsorsPage }))
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
    <Suspense fallback={<RouteLoading />}>
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
  return (
    <AdminSuspense>
      <AdminEventsPage />
    </AdminSuspense>
  );
}

export function AdminClubsRoute() {
  return (
    <AdminSuspense>
      <AdminClubsPage />
    </AdminSuspense>
  );
}

export function AdminPositionsRoute() {
  return <AdminSuspense><AdminPositionsPage /></AdminSuspense>;
}

export function AdminPostersRoute() {
  return (
    <AdminSuspense>
      <AdminPostersPage />
    </AdminSuspense>
  );
}

export function AdminInstagramRoute() {
  return (
    <AdminSuspense>
      <AdminInstagramPage />
    </AdminSuspense>
  );
}

export function AdminDiagnosticsRoute() {
  return (
    <AdminSuspense>
      <AdminDiagnosticsPage />
    </AdminSuspense>
  );
}

export function AdminCompetitorPainPointsRoute() {
  return <AdminSuspense><AdminCompetitorPainPointsPage /></AdminSuspense>;
}

export function AdminOutreachRoute() {
  return <AdminSuspense><AdminOutreachPage /></AdminSuspense>;
}

export function AdminSponsorsRoute() {
  return <AdminSuspense><AdminSponsorsPage /></AdminSuspense>;
}

export function AdminSocialAccountsRoute() {
  return <AdminSuspense><AdminSocialAccountsPage /></AdminSuspense>;
}
