import type { EventListQuery } from "@/features/events/api/events.api";

export function normalizeEventQuery(query: EventListQuery | undefined): EventListQuery {
  return {
    search: query?.search?.trim() || undefined,
    categories: query?.categories?.filter(Boolean) ?? [],
    locations: query?.locations?.filter(Boolean) ?? [],
    foods: query?.foods?.filter(Boolean) ?? [],
    days: query?.days?.filter(Boolean) ?? [],
    minPrice: query?.minPrice,
    maxPrice: query?.maxPrice,
    registration: query?.registration,
    organizations: query?.organizations?.filter(Boolean) ?? [],
    freeFood: query?.freeFood === true,
    ids: query?.ids,
    sortBy: query?.sortBy || "date",
    sortOrder: query?.sortOrder === "desc" ? "desc" : "asc",
    startUtc: query?.startUtc,
    endUtc: query?.endUtc,
    addedWithin24h: query?.addedWithin24h === true,
  };
}

export function getSchoolFetchKey(school: string | null): string {
  return school ?? "__all__";
}
