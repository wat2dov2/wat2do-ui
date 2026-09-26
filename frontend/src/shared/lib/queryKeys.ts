export const queryKeys = {
  admin: {
    all: ["admin"] as const,
    lists: (resource: string) => [...queryKeys.admin.all, resource, "list"] as const,
    list: (resource: string, filters: object) => [...queryKeys.admin.lists(resource), filters] as const,
    count: (resource: string) => [...queryKeys.admin.all, resource, "pending-count"] as const,
    submission: (id: string | null) => [...queryKeys.admin.all, "submission", id] as const,
  },
  meta: {
    all: ["meta"] as const,
    constants: () => [...queryKeys.meta.all, "constants"] as const,
  },
  schools: {
    all: ["schools"] as const,
    directory: () => [...queryKeys.schools.all, "directory"] as const,
  },
  clubs: {
    all: ["clubs"] as const,
    detail: (clubId: number) =>
      [...queryKeys.clubs.all, "detail", clubId] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.clubs.all, "list", filters] as const,
    allForSchool: (school: string | null | undefined) =>
      [...queryKeys.clubs.all, "all", school ?? ""] as const,
  },
  positions: {
    all: ["positions"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.positions.all, "list", filters] as const,
    allForSchool: (school: string) =>
      [...queryKeys.positions.all, "all", school] as const,
    detail: (positionId: number) =>
      [...queryKeys.positions.all, "detail", positionId] as const,
    byClub: (clubId: number, school: string) =>
      [
        ...queryKeys.positions.all,
        "by-club",
        clubId,
        school,
      ] as const,
  },
  positionSubmissions: {
    all: ["position-submissions"] as const,
    list: (page: number, status?: string, school = "", search = "") => [...queryKeys.positionSubmissions.all, page, status ?? "", school, search] as const,
  },
  posters: {
    all: ["posters"] as const,
    list: (school: string | null | undefined) =>
      [
        ...queryKeys.posters.all,
        "list",
        school ?? "",
      ] as const,
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
    list: () => [...queryKeys.scans.all, "list"] as const,
  },
  user: {
    all: ["user"] as const,
  },
  events: {
    all: ["events"] as const,
    detail: (eventId: number) =>
      [...queryKeys.events.all, "detail", eventId] as const,
    attendees: (eventId: number) =>
      [...queryKeys.events.all, "attendees", eventId] as const,
    stats: (school: string) =>
      [...queryKeys.events.all, "stats", school] as const,
    lists: () => [...queryKeys.events.all, "list"] as const,
    feeds: () => [...queryKeys.events.all, "feed"] as const,
    bySchool: (school: string) =>
      [...queryKeys.events.feeds(), school] as const,
    byClub: (clubId: number, school: string) =>
      [
        ...queryKeys.events.lists(),
        "by-club",
        clubId,
        school,
      ] as const,
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
  automateLogs: {
    all: ["automateLogs"] as const,
    list: () => [...queryKeys.automateLogs.all, "list"] as const,
  },
} as const;
