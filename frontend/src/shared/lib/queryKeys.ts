export const queryKeys = {
  organizations: {
    all: ["organizations"] as const,
    detail: (organizationId: number) =>
      [...queryKeys.organizations.all, "detail", organizationId] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.organizations.all, "list", filters] as const,
    allForSchool: (school: string | null | undefined) =>
      [...queryKeys.organizations.all, "all", school ?? ""] as const,
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
    attendees: (eventId: number) => [...queryKeys.events.all, "attendees", eventId] as const,
    stats: (school: string) => [...queryKeys.events.all, "stats", school] as const,
    byOrganization: (organizationName: string, school: string) =>
      [...queryKeys.events.all, "by-organization", organizationName, school] as const,
  },
  goingEvents: {
    all: ["going-events"] as const,
    byUser: (userId: string) => [...queryKeys.goingEvents.all, userId] as const,
  },
  notificationPreferences: {
    all: ["notification-preferences"] as const,
    byUser: (userId: string) =>
      [...queryKeys.notificationPreferences.all, userId] as const,
  },
  instagramPublishing: {
    all: ["instagram-publishing"] as const,
    batches: () => [...queryKeys.instagramPublishing.all, "batches"] as const,
  },
} as const;
