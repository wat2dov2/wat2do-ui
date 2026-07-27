import type {
  PosterLifecycle,
  PromoterPosterEarnings,
} from "@/features/posters/types";

export function getPosterLifecycle(
  poster: Pick<
    PromoterPosterEarnings,
    "isActive" | "latestScan" | "latitude" | "longitude"
  >,
  quietAfterDays: number,
  now = Date.now(),
): PosterLifecycle {
  if (!poster.isActive) {
    return "archived";
  }
  if (
    poster.latitude == null ||
    poster.longitude == null ||
    (poster.latitude === 0 && poster.longitude === 0)
  ) {
    return "not-placed";
  }
  if (!poster.latestScan) {
    return "quiet";
  }
  const quietAfterMs = quietAfterDays * 24 * 60 * 60 * 1000;
  return now - new Date(poster.latestScan).getTime() >= quietAfterMs
    ? "quiet"
    : "recently-scanned";
}
