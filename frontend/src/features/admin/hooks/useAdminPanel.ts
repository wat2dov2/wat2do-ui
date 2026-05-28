import { useMemo, useEffect, useState } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";
import { getSessionEmail } from "@/features/auth";
import { useBackendPosters, type QRCode } from "@/features/posters";
import type { EventSubmission } from "@/shared/types";

type ActivityType = "submission" | "poster";

type ActivityItem =
  | { type: "submission"; data: EventSubmission; timestamp: Date }
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
  const submissionsLoadedAt = useAdminStore((s) => s.loadedAt.submissions);
  const fetchSubmissions = useAdminStore((s) => s.fetchSubmissions);
  const [adminDataLoading, setAdminDataLoading] = useState(
    submissionsLoadedAt === undefined,
  );

  useEffect(() => {
    let cancelled = false;
    fetchSubmissions()
      .catch((err) => console.error("Failed to load submissions:", err))
      .finally(() => {
        if (!cancelled) setAdminDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSubmissions]);

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

    return [...submissionItems, ...createdPosters]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);
  }, [submissions, backendPosters]);

  return {
    recentActivities,
    recentActivityLoading,
  };
}

/** Map an activity item to its display representation. Intended for use by the component layer. */
export function mapActivityDisplay(
  activity: ActivityItem,
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
  return { ...base, label: t("admin.createdPoster"), detail: activity.data.name };
}

export type { ActivityItem, ActivityDisplay };
