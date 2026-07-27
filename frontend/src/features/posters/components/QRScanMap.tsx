import { useEffect, useMemo, useState } from "react";
import Map from "react-map-gl/mapbox";
import { Marker } from "@vis.gl/react-mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

import type { PosterMapMarker } from "@/features/posters/types";
import { MapPin } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";

export interface QRScanMapProps {
  markers: PosterMapMarker[];
  height?: string;
  onMarkerClick?: (posterId: string) => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const COVERAGE_BUCKET_COLORS: Record<
  Extract<PosterMapMarker, { kind: "coverage" }>["confirmedVisitorBucket"],
  string
> = {
  none: "var(--color-muted-foreground)",
  low: "var(--color-success)",
  medium: "var(--color-warning)",
  high: "var(--color-destructive)",
};

function CoverageMarker({
  marker,
}: {
  marker: Extract<PosterMapMarker, { kind: "coverage" }>;
}) {
  const { t } = useTranslation();
  const size = Math.max(18, Math.min(34, 16 + marker.posterCount * 3));
  return (
    <div
      className="group relative"
      aria-label={t("posters.map.coverageMarker", { count: marker.posterCount })}
      role="img"
    >
      <div
        className="rounded-full border-2 border-surface opacity-30 shadow-sm"
        style={{
          width: size,
          height: size,
          backgroundColor: COVERAGE_BUCKET_COLORS[marker.confirmedVisitorBucket],
        }}
      />
      <div className="pointer-events-none absolute bottom-full left-1/2 z-dropdown mb-2 hidden min-w-44 -translate-x-1/2 rounded-lg border border-border bg-surface p-2 text-xs shadow-xl group-hover:block">
        <p className="font-semibold text-foreground">
          {t("posters.map.campusCoverage")}
        </p>
        <p className="text-muted-foreground">
          {t("posters.map.coverageSummary", {
            count: marker.posterCount,
            recent: marker.recentPosterCount,
          })}
        </p>
      </div>
    </div>
  );
}

function ExactMarker({
  marker,
  onMarkerClick,
}: {
  marker: Extract<PosterMapMarker, { kind: "owned" | "managed" }>;
  onMarkerClick?: (posterId: string) => void;
}) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const interactive = Boolean(onMarkerClick);

  const activate = () => onMarkerClick?.(marker.posterId);

  return (
    <div
      className={cn("group relative", interactive && "cursor-pointer")}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={t(
        marker.kind === "owned"
          ? "posters.map.ownedMarker"
          : "posters.map.managedMarker",
        { name: marker.name },
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
      onKeyDown={(event) => {
        if (!interactive || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        activate();
      }}
    >
      <div className="absolute inset-0 rounded-full bg-primary/20 motion-safe:animate-ping" />
      <div className="relative size-6 rounded-full border-2 border-surface bg-primary shadow-lg transition-transform group-hover:scale-110" />
      {isHovered && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-dropdown mb-2 min-w-44 -translate-x-1/2 rounded-lg border border-border bg-surface p-2 text-xs shadow-xl">
          <p className="truncate font-semibold text-foreground">{marker.name}</p>
          <p className="text-muted-foreground">
            {t("posters.map.visitorCount", { count: marker.visitorCount })}
          </p>
        </div>
      )}
    </div>
  );
}

export function QRScanMap({
  markers,
  height = "500px",
  onMarkerClick,
}: QRScanMapProps) {
  const { t } = useTranslation();
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const center = useMemo(() => {
    if (markers.length === 0) {
      return null;
    }
    return {
      latitude:
        markers.reduce((sum, marker) => sum + marker.latitude, 0) / markers.length,
      longitude:
        markers.reduce((sum, marker) => sum + marker.longitude, 0) / markers.length,
    };
  }, [markers]);

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("example") || !center) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-xl border border-border bg-secondary shadow-sm"
        style={{ height }}
        data-testid="poster-map-fallback"
      >
        <div className="p-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
            <MapPin className="size-8 text-primary" />
          </div>
          <p className="mb-2 text-sm font-medium text-foreground">
            {markers.length === 0
              ? t("posters.map.noCoverageTitle")
              : t("qrCode.mapboxTokenMissingTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {markers.length === 0
              ? t("posters.map.noCoverageDescription")
              : t("qrCode.mapboxTokenMissingDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      style={{ height }}
      data-testid="poster-map"
    >
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          longitude: center.longitude,
          latitude: center.latitude,
          zoom: 14,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={
          isDarkMode
            ? "mapbox://styles/mapbox/dark-v11"
            : "mapbox://styles/mapbox/light-v11"
        }
        attributionControl={false}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.key}
            longitude={marker.longitude}
            latitude={marker.latitude}
            anchor="center"
          >
            {marker.kind === "coverage" ? (
              <CoverageMarker marker={marker} />
            ) : (
              <ExactMarker marker={marker} onMarkerClick={onMarkerClick} />
            )}
          </Marker>
        ))}
      </Map>
      <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3 rounded-lg border border-border/50 bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
        {markers.some((marker) => marker.kind === "owned") && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            {t("posters.map.yourPosters")}
          </span>
        )}
        {markers.some((marker) => marker.kind === "managed") && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            {t("posters.map.managedPosters")}
          </span>
        )}
        {markers.some((marker) => marker.kind === "coverage") && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground opacity-30" />
            {t("posters.map.otherCoverage")}
          </span>
        )}
      </div>
    </div>
  );
}
