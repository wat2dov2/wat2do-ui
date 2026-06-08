/**
 * Admin Store (Zustand)
 *
 * Caches backend-owned admin resources behind a 60-second TTL so navigating
 * between admin pages doesn't re-hit the backend. Backend remains
 * authoritative; per AGENTS.md admin data is never persisted to localStorage.
 */

import { create } from "zustand";
import {
  getEventSubmissions,
  getReportedEvents,
  updateEventSubmission,
  getPendingOrganizationClaims,
  resolveClaim,
  type OrganizationClaim,
} from "@/features/admin/api/admin.api";
import {
  REPORT_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import type { EventSubmission } from "@/shared/types";

const TTL_MS = 60_000;

interface LoadedAt {
  submissions?: number;
  reports?: number;
}

interface AdminState {
  submissions: EventSubmission[];
  reportedEventIds: Set<number>;
  claims: OrganizationClaim[];
  loadedAt: LoadedAt;

  fetchSubmissions: (force?: boolean) => Promise<void>;
  fetchReportedEventIds: (force?: boolean) => Promise<void>;
  fetchClaims: () => Promise<void>;
  approveSubmission: (id: string) => Promise<void>;
  rejectSubmission: (id: string, reason: string) => Promise<void>;
  approveClaim: (id: string) => Promise<void>;
  rejectClaim: (id: string, reason?: string) => Promise<void>;
  reset: () => void;
}

const fresh = (ts: number | undefined): boolean =>
  ts !== undefined && Date.now() - ts < TTL_MS;

export const useAdminStore = create<AdminState>((set, get) => ({
  submissions: [],
  reportedEventIds: new Set<number>(),
  claims: [],
  loadedAt: {},

  fetchSubmissions: async (force = false) => {
    if (!force && fresh(get().loadedAt.submissions)) return;
    try {
      const submissions = await getEventSubmissions();
      set((state) => ({
        submissions,
        loadedAt: { ...state.loadedAt, submissions: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    }
  },

  fetchReportedEventIds: async (force = false) => {
    if (!force && fresh(get().loadedAt.reports)) return;
    try {
      const reports = await getReportedEvents();
      const pendingIds = new Set<number>(
        reports.flatMap((r) =>
          r.status === REPORT_PENDING ? [r.eventId] : [],
        ),
      );
      set((state) => ({
        reportedEventIds: pendingIds,
        loadedAt: { ...state.loadedAt, reports: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch reported events:", err);
    }
  },

  fetchClaims: async () => {
    try {
      const claims = await getPendingOrganizationClaims();
      set({ claims });
    } catch (err) {
      console.error("Failed to fetch pending claims:", err);
    }
  },

  approveSubmission: async (id) => {
    try {
      await updateEventSubmission(id, SUBMISSION_APPROVED);
      set((state) => ({
        submissions: state.submissions.map((s) =>
          s.id === id ? { ...s, status: SUBMISSION_APPROVED } : s,
        ),
      }));
    } catch (err) {
      console.error("Failed to approve submission:", err);
      throw err;
    }
  },

  rejectSubmission: async (id, reason) => {
    try {
      await updateEventSubmission(id, SUBMISSION_REJECTED, reason);
      set((state) => ({
        submissions: state.submissions.map((s) =>
          s.id === id
            ? { ...s, status: SUBMISSION_REJECTED, rejectionReason: reason }
            : s,
        ),
      }));
    } catch (err) {
      console.error("Failed to reject submission:", err);
      throw err;
    }
  },

  approveClaim: async (id) => {
    try {
      await resolveClaim(id, "approved");
      set((state) => ({
        claims: state.claims.filter((c) => c.id !== id),
      }));
    } catch (err) {
      console.error("Failed to approve claim:", err);
      throw err;
    }
  },

  rejectClaim: async (id, reason) => {
    try {
      await resolveClaim(id, "rejected", reason);
      set((state) => ({
        claims: state.claims.filter((c) => c.id !== id),
      }));
    } catch (err) {
      console.error("Failed to reject claim:", err);
      throw err;
    }
  },

  reset: () => {
    set({
      submissions: [],
      reportedEventIds: new Set<number>(),
      claims: [],
      loadedAt: {},
    });
  },
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useAdminStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    useAdminStore.getState().reset();
  });
}
