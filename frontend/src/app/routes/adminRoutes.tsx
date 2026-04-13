/**
 * Admin Routes Configuration
 * Centralized admin route handlers and props to reduce duplication.
 *
 * Heavy admin page components are lazy-loaded so they are split into a
 * separate chunk that only admin users ever download.
 */

import React, { lazy, Suspense, useMemo } from "react";
import { AdminProvider } from "@/features/admin/context/AdminContext";
import type { Event, EventFormData, EventSubmission, Club } from "@/shared/types";
import { submissionToEventData } from "@/features/admin/utils/submissionToEvent";
import { adminCreateClub, adminUpdateClub, adminDeleteClub } from "@/features/admin/api/admin.api";
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
  events: Event[];
  onEditEvent: (event: Event) => void | Promise<void>;
  onDeleteEvent: (eventId: number) => Promise<void>;
  onCreateEvent: () => void;
  onAddEvent: (eventData: EventFormData) => Promise<number>;
  userEmail: string | null;
}

interface AdminRouteWrapperProps {
  config: AdminRoutesConfig;
  children: React.ReactNode;
  includeEvents?: boolean;
  includeClubs?: boolean;
  includeSubmissions?: boolean;
  includePosters?: boolean;
}

/**
 * Wrapper component for admin routes that provides AdminProvider with common props
 */
export function AdminRouteWrapper({
  config,
  children,
  includeEvents = false,
  includeClubs = false,
  includeSubmissions = false,
  includePosters = false,
}: AdminRouteWrapperProps) {
  const navigate = useNavigate();

  const adminProps = useMemo(
    () => ({
      events: config.events,
      onBack: () => navigate(ROUTES.ADMIN),
      ...(includeEvents && {
        onEditEvent: config.onEditEvent,
        onDeleteEvent: config.onDeleteEvent,
        onCreateEvent: config.onCreateEvent,
      }),
      ...(includeClubs && {
        onAddClub: async (club: Club) => {
          await adminCreateClub(club);
        },
        onEditClub: async (club: Club) => {
          await adminUpdateClub(club, club);
        },
        onDeleteClub: async (clubId: number) => {
          await adminDeleteClub(clubId);
        },
      }),
      ...(includeSubmissions && {
        onApprove: (submission: EventSubmission) => {
          config.onAddEvent(submissionToEventData(submission));
        },
      }),
      ...(includePosters && {
        userEmail: config.userEmail || "",
      }),
    }),
    [config, includeEvents, includeClubs, includeSubmissions, includePosters, navigate]
  );

  return <AdminProvider {...adminProps}>{children}</AdminProvider>;
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
export function AdminPanelRoute({ config }: { config: AdminRoutesConfig }) {
  const handleNavigate = useAdminNavigation();

  return (
    <AdminRouteWrapper
      config={config}
      includeEvents
      includeClubs
      includeSubmissions
    >
      <AdminSuspense>
        <AdminPanel events={config.events} onNavigate={handleNavigate} />
      </AdminSuspense>
    </AdminRouteWrapper>
  );
}

/**
 * Admin Events Route Component
 */
export function AdminEventsRoute({ config }: { config: AdminRoutesConfig }) {
  return (
    <AdminRouteWrapper config={config} includeEvents>
      <AdminSuspense>
        <AdminEventsPage />
      </AdminSuspense>
    </AdminRouteWrapper>
  );
}

/**
 * Admin Clubs Route Component
 */
export function AdminClubsRoute({ config }: { config: AdminRoutesConfig }) {
  return (
    <AdminRouteWrapper config={config} includeClubs>
      <AdminSuspense>
        <AdminClubsPage />
      </AdminSuspense>
    </AdminRouteWrapper>
  );
}

/**
 * Admin Submissions Route Component
 */
export function AdminSubmissionsRoute({ config }: { config: AdminRoutesConfig }) {
  const navigate = useNavigate();

  return (
    <AdminRouteWrapper config={config} includeSubmissions>
      <AdminSuspense>
        <AdminSubmissionsPage onBack={() => navigate(ROUTES.ADMIN)} />
      </AdminSuspense>
    </AdminRouteWrapper>
  );
}

/**
 * Admin Posters Route Component
 */
export function AdminPostersRoute({ config }: { config: AdminRoutesConfig }) {
  return (
    <AdminRouteWrapper config={config} includePosters>
      <AdminSuspense>
        <AdminPostersPage />
      </AdminSuspense>
    </AdminRouteWrapper>
  );
}
