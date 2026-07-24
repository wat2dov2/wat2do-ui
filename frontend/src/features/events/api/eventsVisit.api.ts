import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

type EventsVisitTimestamps = Record<string, string>;

function readEventsVisitTimestamps(): EventsVisitTimestamps {
  const stored = StorageService.getItem<unknown>(
    STORAGE_KEYS.EVENT_VISITS,
    {},
  );
  return stored && typeof stored === "object" && !Array.isArray(stored)
    ? { ...(stored as EventsVisitTimestamps) }
    : {};
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function eventsVisitKey(userEmail: string, school: string): string {
  return `${userEmail.trim().toLowerCase()}:${school.trim().toLowerCase()}`;
}

export function loadEventsVisit(
  userEmail: string,
  school: string,
): string | null {
  const visits = readEventsVisitTimestamps();
  const key = eventsVisitKey(userEmail, school);
  const visitedAt = visits[key];
  return isValidTimestamp(visitedAt) ? visitedAt : null;
}

export function saveEventsVisit(
  userEmail: string,
  school: string,
  visitedAt: string,
): void {
  const visits = readEventsVisitTimestamps();
  const key = eventsVisitKey(userEmail, school);
  visits[key] = visitedAt;
  StorageService.setItem(STORAGE_KEYS.EVENT_VISITS, visits);
}
