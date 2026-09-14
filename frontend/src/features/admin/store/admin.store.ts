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
  getClubClaims,
  getClubSubmissions,
  resolveClaim,
  resolveClubReview,
  type ClubClaim,
} from "@/features/admin/api/admin.api";
import {
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import { controlBox } from "@/shared/config/controlBox";
import type { EventSubmission, ReportedEvent, Club, ClubStatus } from "@/shared/types";

interface LoadedAt {
  submissions?: number;
  reports?: number;
  claims?: number;
  clubSubmissions?: number;
}

interface AdminState {
  submissions: EventSubmission[];
  reports: ReportedEvent[];
  claims: ClubClaim[];
  clubSubmissions: Club[];
  loadedAt: LoadedAt;
  submissionsSchool?: string;
  claimsSchool?: string;
  clubSubmissionsSchool?: string;

  fetchSubmissions: (school?: string, force?: boolean) => Promise<void>;
  fetchReports: (force?: boolean) => Promise<void>;
  fetchClaims: (school?: string, force?: boolean) => Promise<void>;
  fetchClubSubmissions: (school?: string, force?: boolean) => Promise<void>;
  reviewClub: (clubId: number, status: ClubStatus) => Promise<void>;
  approveSubmission: (id: string) => Promise<void>;
  rejectSubmission: (id: string, reason: string) => Promise<void>;
  approveClaim: (id: string) => Promise<void>;
  rejectClaim: (id: string, reason?: string) => Promise<void>;
  reset: () => void;
}

const fresh = (ts: number | undefined): boolean =>
  ts !== undefined && Date.now() - ts < controlBox.clientCache.adminStaleMs;

export const useAdminStore = create<AdminState>((set, get) => ({
  submissions: [],
  reports: [],
  claims: [],
  clubSubmissions: [],
  loadedAt: {},
  submissionsSchool: undefined,
  claimsSchool: undefined,
  clubSubmissionsSchool: undefined,

  fetchSubmissions: async (school, force = false) => {
    const isSchoolChanged = school !== get().submissionsSchool;
    if (!force && !isSchoolChanged && fresh(get().loadedAt.submissions)) return;
    try {
      const submissions = await getEventSubmissions(school);
      set((state) => ({
        submissions,
        submissionsSchool: school,
        loadedAt: { ...state.loadedAt, submissions: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
      throw err;
    }
  },

  fetchReports: async (force = false) => {
    if (!force && fresh(get().loadedAt.reports)) return;
    try {
      const reports = await getReportedEvents();
      set((state) => ({
        reports,
        loadedAt: { ...state.loadedAt, reports: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch reported events:", err);
      throw err;
    }
  },

  fetchClaims: async (school, force = false) => {
    const isSchoolChanged = school !== get().claimsSchool;
    if (!force && !isSchoolChanged && fresh(get().loadedAt.claims)) return;
    try {
      const claims = await getClubClaims(undefined, school);
      set((state) => ({
        claims,
        claimsSchool: school,
        loadedAt: { ...state.loadedAt, claims: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch claims:", err);
      throw err;
    }
  },

  fetchClubSubmissions: async (school, force = false) => {
    const isSchoolChanged = school !== get().clubSubmissionsSchool;
    if (!force && !isSchoolChanged && fresh(get().loadedAt.clubSubmissions)) return;
    try {
      const clubSubmissions = await getClubSubmissions(undefined, school);
      set((state) => ({
        clubSubmissions,
        clubSubmissionsSchool: school,
        loadedAt: { ...state.loadedAt, clubSubmissions: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch clubs for review:", err);
      throw err;
    }
  },

  reviewClub: async (clubId, status) => {
    try {
      await resolveClubReview(clubId, status);
      set((state) => ({
        clubSubmissions: state.clubSubmissions.map((club) =>
          club.id === clubId ? { ...club, status } : club,
        ),
      }));
    } catch (err) {
      console.error("Failed to review club:", err);
      throw err;
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
        claims: state.claims.map((c) =>
          c.id === id ? { ...c, status: "approved" } : c
        ),
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
        claims: state.claims.map((c) =>
          c.id === id
            ? { ...c, status: "rejected", rejection_reason: reason ?? null }
            : c
        ),
      }));
    } catch (err) {
      console.error("Failed to reject claim:", err);
      throw err;
    }
  },

  reset: () => {
    set({
      submissions: [],
      reports: [],
      claims: [],
      clubSubmissions: [],
      loadedAt: {},
      submissionsSchool: undefined,
      claimsSchool: undefined,
      clubSubmissionsSchool: undefined,
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
