/**
 * Admin Context
 * Provides shared callbacks and data for admin pages to reduce prop drilling
 */

import React, { createContext, useContext } from "react";
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

export function AdminProvider({ children, ...value }: AdminProviderProps) {
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
