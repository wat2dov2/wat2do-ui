export const queryKeys = {
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
  events: {
    all: ["events"] as const,
    detail: (eventId: number) => [...queryKeys.events.all, "detail", eventId] as const,
    stats: (school: string) => [...queryKeys.events.all, "stats", school] as const,
  },
} as const;
