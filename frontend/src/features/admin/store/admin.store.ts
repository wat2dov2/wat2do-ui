/**
 * Admin Store (Zustand)
 *
 * Caches backend-owned admin resources (submissions, reported event IDs,
 * scraped events) behind a 60-second TTL so navigating between admin pages
 * doesn't re-hit the backend. Backend remains authoritative; per AGENTS.md
 * admin data is never persisted to localStorage.
 *
 * Status mutations (approve / reject) patch the local submissions list on
 * success so the UI reflects truth without a blanket refetch. Approvals
 * also push the materialised event into `useEventsStore` because the
 * backend PATCH /submissions/{id} flow does NOT auto-create the event row
 * (see `backend/services/submission_service.update_submission`).
 */

import { create } from "zustand";
import {
  getEventSubmissions,
  getReportedEvents,
  getScrapedEvents,
  updateEventSubmission,
} from "@/features/admin/api/admin.api";
import { submissionToEventData } from "@/features/admin/utils/submissionToEvent";
import { useEventsStore } from "@/features/events/store/events.store";
import {
  REPORT_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import type { EventSubmission, ScrapedEvent } from "@/shared/types";

const TTL_MS = 60_000;

interface LoadedAt {
  submissions?: number;
  reports?: number;
  scraped?: number;
}

interface AdminState {
  submissions: EventSubmission[];
  reportedEventIds: Set<number>;
  scrapedEvents: ScrapedEvent[];
  loadedAt: LoadedAt;

  fetchSubmissions: (force?: boolean) => Promise<void>;
  fetchReportedEventIds: (force?: boolean) => Promise<void>;
  fetchScrapedEvents: (force?: boolean) => Promise<void>;
  approveSubmission: (id: string) => Promise<void>;
  rejectSubmission: (id: string, reason: string) => Promise<void>;
}

const fresh = (ts: number | undefined): boolean =>
  ts !== undefined && Date.now() - ts < TTL_MS;

export const useAdminStore = create<AdminState>((set, get) => ({
  submissions: [],
  reportedEventIds: new Set<number>(),
  scrapedEvents: [],
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

  fetchScrapedEvents: async (force = false) => {
    if (!force && fresh(get().loadedAt.scraped)) return;
    try {
      const scrapedEvents = await getScrapedEvents();
      set((state) => ({
        scrapedEvents,
        loadedAt: { ...state.loadedAt, scraped: Date.now() },
      }));
    } catch (err) {
      console.error("Failed to fetch scraped events:", err);
    }
  },

  approveSubmission: async (id) => {
    const submission = get().submissions.find((s) => s.id === id);
    if (!submission) {
      console.error("approveSubmission: submission not found in store:", id);
      return;
    }
    try {
      await updateEventSubmission(id, SUBMISSION_APPROVED);
      // Backend does not auto-create the event row on status flip, so push
      // the materialised event into the events store ourselves. If this
      // throws we still mark the submission approved — keeping the server
      // state the source of truth — but surface the error for diagnosis.
      try {
        await useEventsStore.getState().addEvent(submissionToEventData(submission));
      } catch (eventErr) {
        console.error("Failed to materialise event from approved submission:", eventErr);
      }
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
}));
