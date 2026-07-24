import { useEffect, useMemo, useState } from "react";
import {
  loadEventsVisit,
  saveEventsVisit,
} from "@/features/events/api/eventsVisit.api";

export function useLastEventsVisit(
  userEmail: string | null,
  school: string,
): string | null {
  const [visitStartedAt] = useState(() => new Date().toISOString());
  const lastVisitAt = useMemo(
    () =>
      userEmail
        ? loadEventsVisit(userEmail, school) ?? visitStartedAt
        : null,
    [school, userEmail, visitStartedAt],
  );

  useEffect(() => {
    if (userEmail) {
      saveEventsVisit(userEmail, school, visitStartedAt);
    }
  }, [school, userEmail, visitStartedAt]);

  return lastVisitAt;
}
