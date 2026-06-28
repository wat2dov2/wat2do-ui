function stableEventQueryKey(input: object): Record<string, unknown> {
  const query = input as Record<string, unknown>;

  return {
    search: query.search ?? "",
    categories: query.categories ?? [],
    locations: query.locations ?? [],
    foods: query.foods ?? [],
    days: query.days ?? [],
    minPrice: query.minPrice ?? null,
    maxPrice: query.maxPrice ?? null,
    registration: query.registration ?? null,
    organizations: query.organizations ?? [],
    freeFood: query.freeFood === true,
    ids: query.ids ?? null,
    sortBy: query.sortBy ?? "date",
    sortOrder: query.sortOrder ?? "asc",
    startUtc: query.startUtc ?? null,
    endUtc: query.endUtc ?? null,
    addedWithin24h: query.addedWithin24h === true,
  };
}

export const queryKeys = {
  events: {
    all: ["events"] as const,
    feed: (school: string, query: object) =>
      [...queryKeys.events.all, "feed", school, stableEventQueryKey(query)] as const,
    promoted: (school: string) => [...queryKeys.events.all, "promoted", school] as const,
  },
  organizations: {
    all: ["organizations"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.organizations.all, "list", filters] as const,
    allForSchool: (school: string | null | undefined) =>
      [...queryKeys.organizations.all, "all", school ?? ""] as const,
    adminTypes: (school: string | null | undefined, refreshCounter: number) =>
      [...queryKeys.organizations.all, "admin-types", school ?? "", refreshCounter] as const,
  },
  posters: {
    all: ["posters"] as const,
    list: (school: string | null | undefined, refreshKey?: number) =>
      [...queryKeys.posters.all, "list", school ?? "", refreshKey ?? 0] as const,
  },
  scans: {
    all: ["scans"] as const,
    list: (refreshKey?: number) => [...queryKeys.scans.all, "list", refreshKey ?? 0] as const,
  },
  user: {
    all: ["user"] as const,
  },
} as const;
