import type {
  CampusCoverage,
  PosterMapMarker,
  PromoterPosterEarnings,
  QRCode,
  QRCodeScan,
} from "@/features/posters/types";
import { getQRImageUrl } from "@/features/posters/api/posters.api";

function hasUsableLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    (latitude !== 0 || longitude !== 0)
  );
}

export function buildManagedPosterMapMarkers(
  posters: QRCode[],
  scans: QRCodeScan[],
): PosterMapMarker[] {
  const visitorCounts = new Map<string, number>();
  for (const scan of scans) {
    visitorCounts.set(
      scan.qrCodeId,
      (visitorCounts.get(scan.qrCodeId) ?? 0) + 1,
    );
  }

  return posters.flatMap((poster) => {
    if (!hasUsableLocation(poster.latitude, poster.longitude)) {
      return [];
    }
    return [
      {
        kind: "managed" as const,
        key: `managed:${poster.id}`,
        posterId: poster.id,
        name: poster.name,
        latitude: poster.latitude,
        longitude: poster.longitude,
        visitorCount: visitorCounts.get(poster.id) ?? 0,
        imageUrl: poster.imageUrl ? getQRImageUrl(poster.imageUrl) : null,
      },
    ];
  });
}

export function buildOwnedPosterMapMarkers(
  posters: PromoterPosterEarnings[],
): PosterMapMarker[] {
  return posters.flatMap((poster) => {
    if (!hasUsableLocation(poster.latitude, poster.longitude)) {
      return [];
    }
    return [
      {
        kind: "owned" as const,
        key: `owned:${poster.id}`,
        posterId: poster.id,
        name: poster.name,
        latitude: poster.latitude,
        longitude: poster.longitude,
        visitorCount: poster.lifetimeUniqueVisitors,
        imageUrl: poster.templatePreviewUrl,
      },
    ];
  });
}

export function buildCoverageMapMarkers(
  coverage: CampusCoverage | undefined,
): PosterMapMarker[] {
  return (coverage?.cells ?? []).map((cell, index) => ({
    kind: "coverage",
    key: `coverage:${cell.latitude}:${cell.longitude}:${index}`,
    ...cell,
  }));
}
