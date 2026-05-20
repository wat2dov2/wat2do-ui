import { useMemo, useEffect, useState } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";
import { getSessionEmail } from "@/features/auth";
import { useBackendPosters } from "@/shared/hooks/useBackendPosters";
import type { EventSubmission, ScrapedEvent } from "@/shared/types";
import type { QRCode } from "@/shared/types";

type ActivityType = "submission" | "scraped" | "poster";

type ActivityItem =
  | { type: "submission"; data: EventSubmission; timestamp: Date }
  | { type: "scraped"; data: ScrapedEvent; timestamp: Date }
  | { type: "poster"; data: QRCode; timestamp: Date };

/** Pre-mapped display representation of an activity item. */
interface ActivityDisplay {
  id: string;
  type: ActivityType;
  label: string;
  detail: string;
  submittedBy?: string;
  timestamp: Date;
}

export function useAdminPanel() {
  const { posters: backendPosters, loading: postersLoading } = useBackendPosters();
  const submissions = useAdminStore((s) => s.submissions);
  const scrapedEvents = useAdminStore((s) => s.scrapedEvents);
  const submissionsLoadedAt = useAdminStore((s) => s.loadedAt.submissions);
  const scrapedLoadedAt = useAdminStore((s) => s.loadedAt.scraped);
  const fetchSubmissions = useAdminStore((s) => s.fetchSubmissions);
  const fetchScrapedEvents = useAdminStore((s) => s.fetchScrapedEvents);
  const [adminDataLoading, setAdminDataLoading] = useState(
    submissionsLoadedAt === undefined || scrapedLoadedAt === undefined,
  );

  // Fetch submissions and scraped events via the store (cached with TTL).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSubmissions(), fetchScrapedEvents()])
      .catch((err) => console.error("Failed to load admin data:", err))
      .finally(() => {
        if (!cancelled) setAdminDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSubmissions, fetchScrapedEvents]);

  const recentActivityLoading = postersLoading || adminDataLoading;

  // Get recent activities
  const recentActivities = useMemo(() => {
    const submissionItems: ActivityItem[] = submissions.flatMap((s) =>
      s.status === SUBMISSION_PENDING
        ? [{
            type: "submission" as const,
            data: s,
            timestamp: new Date(s.submittedAt),
          }]
        : [],
    );

    const scrapedItems: ActivityItem[] = scrapedEvents.map((s) => ({
      type: "scraped" as const,
      data: s,
      timestamp: new Date(s.scrapedAt),
    }));

    const userEmail = getSessionEmail() ?? "";
    const createdPosters: ActivityItem[] = backendPosters.flatMap((qr) =>
      qr.createdBy === userEmail
        ? [{
            type: "poster" as const,
            data: qr,
            timestamp: new Date(qr.createdAt),
          }]
        : [],
    );

    const all: ActivityItem[] = [...submissionItems, ...scrapedItems, ...createdPosters];

    return all
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);
  }, [submissions, scrapedEvents, backendPosters]);

  return {
    recentActivities,
    recentActivityLoading,
  };
}

/** Map an activity item to its display representation. Intended for use by the component layer. */
export function mapActivityDisplay(
  activity: ActivityItem,
  events: import("@/shared/types").Event[],
  t: (key: string) => string,
): ActivityDisplay {
  const base = { id: activity.data.id, type: activity.type, timestamp: activity.timestamp };
  if (activity.type === "submission") {
    return {
      ...base,
      label: t("admin.newEventSubmission"),
      detail: activity.data.eventData.title,
      submittedBy: activity.data.submittedBy,
    };
  }
  if (activity.type === "scraped") {
    const event = events.find((e) => e.id === Number(activity.data.eventId));
    const clubName = event?.organization || event?.display_handle || "Unknown";
    const detail = event
      ? `${event.title} (${clubName})`
      : `Event ID ${activity.data.eventId}`;
    // Navigation uses eventId (the referenced event), not the scraped record id
    return { ...base, id: String(activity.data.eventId), label: t("admin.eventScraped"), detail };
  }
  // poster
  return { ...base, label: "Created poster", detail: activity.data.name };
}

export type { ActivityItem, ActivityDisplay };
