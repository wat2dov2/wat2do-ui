import { useMemo } from "react";
import { getSessionEmail } from "@/features/auth";
import { useBackendPosters } from "@/shared/hooks/useBackendPosters";
import type { QRCode } from "@/shared/types";

type ActivityType = "poster";

type ActivityItem = { type: "poster"; data: QRCode; timestamp: Date };

/** Pre-mapped display representation of an activity item. */
interface ActivityDisplay {
  id: string;
  type: ActivityType;
  label: string;
  detail: string;
  timestamp: Date;
}

export function useAdminPanel() {
  const { posters: backendPosters, loading: postersLoading } = useBackendPosters();
  const recentActivityLoading = postersLoading;

  // Get recent activities
  const recentActivities = useMemo(() => {
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

    return createdPosters
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);
  }, [backendPosters]);

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
  return { ...base, label: t("admin.createdPoster"), detail: activity.data.name };
}

export type { ActivityItem, ActivityDisplay };
