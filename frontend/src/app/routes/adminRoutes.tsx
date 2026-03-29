/**
 * Admin Routes Configuration
 * Centralized admin route handlers and props to reduce duplication
 */

import React, { useMemo } from "react";
import { AdminProvider } from "@/features/admin";
import { AdminPanel } from "@/features/admin";
import { AdminEventsPage } from "@/features/admin";
import { AdminClubsPage } from "@/features/admin";
import { AdminSubmissionsPage } from "@/features/admin";
import { AdminPostersPage } from "@/features/admin";
import type { Event, EventSubmission, Club, EventFormData } from "@/shared/types";
import { submissionToEventData } from "@/features/admin/utils/submissionToEvent";
import { useNavigation } from "@/contexts/NavigationContext";

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
  const { navigate } = useNavigation();

  const adminProps = useMemo(
    () => ({
      events: config.events,
      onBack: () => navigate("/admin"),
      ...(includeEvents && {
        onEditEvent: config.onEditEvent,
        onDeleteEvent: config.onDeleteEvent,
        onCreateEvent: config.onCreateEvent,
      }),
      ...(includeClubs && {
        onAddClub: async (club: Club) => {
          const { adminCreateClub } = await import("@/features/admin/api/admin.api");
          await adminCreateClub(club);
        },
        onEditClub: async (club: Club) => {
          const { adminUpdateClub } = await import("@/features/admin/api/admin.api");
          await adminUpdateClub(club, club);
        },
        onDeleteClub: async (clubId: number) => {
          const { adminDeleteClub } = await import("@/features/admin/api/admin.api");
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
 * Admin route mapping for navigation
 */
// eslint-disable-next-line react-refresh/only-export-components
export const ADMIN_ROUTE_MAP: Record<string, string> = {
  "admin-events": "/admin/events",
  "admin-clubs": "/admin/clubs",
  "admin-submissions": "/admin/submissions",
  "admin-posters": "/admin/posters",
};

/**
 * Admin panel navigation handler
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAdminNavigation() {
  const { navigate } = useNavigation();

  return useMemo(
    () => (page: string) => {
      navigate(ADMIN_ROUTE_MAP[page] || "/admin");
    },
    [navigate]
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
      <AdminPanel events={config.events} onNavigate={handleNavigate} />
    </AdminRouteWrapper>
  );
}

/**
 * Admin Events Route Component
 */
export function AdminEventsRoute({ config }: { config: AdminRoutesConfig }) {
  return (
    <AdminRouteWrapper config={config} includeEvents>
      <AdminEventsPage />
    </AdminRouteWrapper>
  );
}

/**
 * Admin Clubs Route Component
 */
export function AdminClubsRoute({ config }: { config: AdminRoutesConfig }) {
  return (
    <AdminRouteWrapper config={config} includeClubs>
      <AdminClubsPage />
    </AdminRouteWrapper>
  );
}

/**
 * Admin Submissions Route Component
 */
export function AdminSubmissionsRoute({ config }: { config: AdminRoutesConfig }) {
  const { navigate } = useNavigation();

  return (
    <AdminRouteWrapper config={config} includeSubmissions>
      <AdminSubmissionsPage onBack={() => navigate("/admin")} />
    </AdminRouteWrapper>
  );
}

/**
 * Admin Posters Route Component
 */
export function AdminPostersRoute({ config }: { config: AdminRoutesConfig }) {
  return (
    <AdminRouteWrapper config={config} includePosters>
      <AdminPostersPage />
    </AdminRouteWrapper>
  );
}
