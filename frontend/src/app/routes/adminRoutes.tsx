/**
 * Admin Routes Configuration
 * Centralized admin route handlers and props to reduce duplication.
 *
 * Heavy admin page components are lazy-loaded so they are split into a
 * separate chunk that only admin users ever download.
 */

import React, { lazy, Suspense, useMemo } from "react";
import type { Event, EventFormData, Club } from "@/shared/types";
import {
  adminCreateClub,
  adminUpdateClub,
  adminDeleteClub,
} from "@/features/admin/api/admin.api";
import { useNavigate } from "react-router-dom";
import { ROUTES, ADMIN_ROUTE_MAP } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

// Lazy-loaded admin page components — only fetched when an admin route renders.
const AdminPanel = lazy(() =>
  import("@/features/admin").then((m) => ({ default: m.AdminPanel }))
);
const AdminEventsPage = lazy(() =>
  import("@/features/admin").then((m) => ({ default: m.AdminEventsPage }))
);
const AdminClubsPage = lazy(() =>
  import("@/features/admin").then((m) => ({ default: m.AdminClubsPage }))
);
const AdminSubmissionsPage = lazy(() =>
  import("@/features/admin").then((m) => ({ default: m.AdminSubmissionsPage }))
);
const AdminPostersPage = lazy(() =>
  import("@/features/admin").then((m) => ({ default: m.AdminPostersPage }))
);

interface AdminRoutesConfig {
  onEditEvent: (event: Event) => void | Promise<void>;
  onDeleteEvent: (eventId: number) => Promise<void>;
  onCreateEvent: () => void;
  onAddEvent: (eventData: EventFormData) => Promise<number>;
}

/**
 * Admin panel navigation handler
 */
export function useAdminNavigation() {
  const navigate = useNavigate();

  return useMemo(
    () => (page: string) => {
      navigate(ADMIN_ROUTE_MAP[page] || ROUTES.ADMIN);
    },
    [navigate]
  );
}

/** Suspense wrapper for lazy-loaded admin pages. */
function AdminSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingPage className="min-h-[400px]" />}>
      {children}
    </Suspense>
  );
}

/**
 * Admin Panel Route Component
 */
export function AdminPanelRoute({ config: _config }: { config: AdminRoutesConfig }) {
  const handleNavigate = useAdminNavigation();

  return (
    <AdminSuspense>
      {/* AdminPanel renders dashboard widgets that source their own data
          via store hooks; the legacy ``events`` prop is unused but still
          required by the type. Pass an empty array to satisfy it. */}
      <AdminPanel events={[]} onNavigate={handleNavigate} />
    </AdminSuspense>
  );
}

/**
 * Admin Events Route Component
 */
export function AdminEventsRoute({ config }: { config: AdminRoutesConfig }) {
  const navigate = useNavigate();
  const onBack = useMemo(() => () => navigate(ROUTES.ADMIN), [navigate]);

  return (
    <AdminSuspense>
      <AdminEventsPage
        onEditEvent={config.onEditEvent}
        onDeleteEvent={config.onDeleteEvent}
        onCreateEvent={config.onCreateEvent}
        onBack={onBack}
      />
    </AdminSuspense>
  );
}

/**
 * Admin Clubs Route Component
 */
export function AdminClubsRoute({ config: _config }: { config: AdminRoutesConfig }) {
  const navigate = useNavigate();
  const onBack = useMemo(() => () => navigate(ROUTES.ADMIN), [navigate]);

  const onAddClub = useMemo(
    () => async (club: Club) => {
      await adminCreateClub(club);
    },
    [],
  );
  const onEditClub = useMemo(
    () => async (club: Club) => {
      await adminUpdateClub(club, club);
    },
    [],
  );
  const onDeleteClub = useMemo(
    () => async (clubId: number) => {
      await adminDeleteClub(clubId);
    },
    [],
  );

  return (
    <AdminSuspense>
      <AdminClubsPage
        onBack={onBack}
        onAddClub={onAddClub}
        onEditClub={onEditClub}
        onDeleteClub={onDeleteClub}
      />
    </AdminSuspense>
  );
}

/**
 * Admin Submissions Route Component
 */
export function AdminSubmissionsRoute({ config: _config }: { config: AdminRoutesConfig }) {
  const navigate = useNavigate();

  return (
    <AdminSuspense>
      <AdminSubmissionsPage onBack={() => navigate(ROUTES.ADMIN)} />
    </AdminSuspense>
  );
}

/**
 * Admin Posters Route Component
 */
export function AdminPostersRoute({ config: _config }: { config: AdminRoutesConfig }) {
  return (
    <AdminSuspense>
      <AdminPostersPage />
    </AdminSuspense>
  );
}
