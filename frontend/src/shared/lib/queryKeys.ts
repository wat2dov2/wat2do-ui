export const queryKeys = {
  schools: {
    all: ["schools"] as const,
    directory: () => [...queryKeys.schools.all, "directory"] as const,
  },
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
    earnings: (userId: string | null | undefined) =>
      [...queryKeys.posters.all, "earnings", userId ?? ""] as const,
    coverage: (school: string | null | undefined) =>
      [...queryKeys.posters.all, "coverage", school ?? ""] as const,
    payouts: (userId: string | null | undefined) =>
      [...queryKeys.posters.all, "payouts", userId ?? ""] as const,
  },
  posterPayouts: {
    all: ["poster-payouts"] as const,
    admin: () => [...queryKeys.posterPayouts.all, "admin"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.posterPayouts.admin(), "list", filters] as const,
    detail: (payoutId: string) =>
      [...queryKeys.posterPayouts.admin(), "detail", payoutId] as const,
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
    bySchool: (school: string) =>
      [...queryKeys.events.all, "by-school", school] as const,
    byOrganization: (organizationId: number, school: string) =>
      [...queryKeys.events.all, "by-organization", organizationId, school] as const,
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
    batchPage: (page: number, pageSize: number) =>
      [...queryKeys.instagramPublishing.batches(), page, pageSize] as const,
    batch: (batchId: string) =>
      [...queryKeys.instagramPublishing.all, "batch", batchId] as const,
  },
} as const;
