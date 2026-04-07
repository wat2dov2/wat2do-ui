/**
 * Admin Context
 * Provides shared callbacks and data for admin pages to reduce prop drilling.
 *
 * Note: This context bundles events, clubs, submissions, and posters concerns.
 * The AdminRouteWrapper (adminRoutes.tsx) already scopes which callbacks each
 * route receives. The memoization below prevents unnecessary re-renders when
 * the parent re-renders with the same logical values.
 */

import React, { createContext, useContext, useMemo } from "react";
import type { Event, Club, EventSubmission } from "@/shared/types";

interface AdminContextValue {
  // Events
  events: Event[];
  onEditEvent?: (event: Event) => void | Promise<void>;
  onDeleteEvent?: (eventId: number) => void;
  onCreateEvent?: () => void;

  // Clubs
  onAddClub?: (club: Club) => void;
  onEditClub?: (club: Club) => void;
  onDeleteClub?: (clubId: number) => void;

  // Submissions
  onApprove?: (submission: EventSubmission) => void;

  // Posters/QR Codes
  userEmail?: string;

  // Navigation
  onBack: () => void;
}

// Helper hook for optional context (for pages that might not be wrapped)
export function useAdminContextOptional(): AdminContextValue | null {
  return useContext(AdminContext);
}

const AdminContext = createContext<AdminContextValue | null>(null);

interface AdminProviderProps extends AdminContextValue {
  children: React.ReactNode;
}

export function AdminProvider({
  children,
  events,
  onEditEvent,
  onDeleteEvent,
  onCreateEvent,
  onAddClub,
  onEditClub,
  onDeleteClub,
  onApprove,
  userEmail,
  onBack,
}: AdminProviderProps) {
  const value = useMemo<AdminContextValue>(
    () => ({
      events,
      onEditEvent,
      onDeleteEvent,
      onCreateEvent,
      onAddClub,
      onEditClub,
      onDeleteClub,
      onApprove,
      userEmail,
      onBack,
    }),
    [
      events,
      onEditEvent,
      onDeleteEvent,
      onCreateEvent,
      onAddClub,
      onEditClub,
      onDeleteClub,
      onApprove,
      userEmail,
      onBack,
    ]
  );

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdminContext() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdminContext must be used within AdminProvider");
  }
  return context;
}
