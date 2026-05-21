/**
 * Admin Store (Zustand)
 *
 * Caches backend-owned admin resources behind a 60-second TTL so navigating
 * between admin pages doesn't re-hit the backend. Backend remains
 * authoritative; per AGENTS.md admin data is never persisted to localStorage.
 */

import { create } from "zustand";
import { getReportedEvents } from "@/features/admin/api/admin.api";
import { REPORT_PENDING } from "@/shared/constants/statuses";

const TTL_MS = 60_000;

interface LoadedAt {
  reports?: number;
}

interface AdminState {
  reportedEventIds: Set<number>;
  loadedAt: LoadedAt;

  fetchReportedEventIds: (force?: boolean) => Promise<void>;
}

const fresh = (ts: number | undefined): boolean =>
  ts !== undefined && Date.now() - ts < TTL_MS;

export const useAdminStore = create<AdminState>((set, get) => ({
  reportedEventIds: new Set<number>(),
  loadedAt: {},

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
}));
