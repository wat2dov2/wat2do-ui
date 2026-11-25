/** Labels of the admin's "last N days" choices, keyed by the number of days. */
export const DAY_WINDOW_LABEL_KEYS = {
  1: "admin.diagnostics.latency.last24Hours",
  3: "admin.last3Days",
  7: "qrCode.last7Days",
  30: "admin.last30Days",
} as const;

export type DayWindow = keyof typeof DAY_WINDOW_LABEL_KEYS;
