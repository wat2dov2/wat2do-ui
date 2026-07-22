import React, { useMemo, useState, useEffect } from "react";
import Map from "react-map-gl/mapbox";
import { Marker } from "@vis.gl/react-mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { QRCode, QRCodeScan } from "@/features/posters/types";
import { MapPin, Zap } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";

interface QRScanMapProps {
  scans: QRCodeScan[];
  posters: QRCode[];
  height?: string;
  onMarkerClick?: (qrCodeId: string) => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Green (low) -> yellow (mid) -> red (high) by scan-count ratio; HSL from Tailwind greens/yellows/reds.
function getColorForScanCount(count: number, maxCount: number): string {
  if (maxCount === 0) return "hsl(216, 100%, 42%)";
  
  const ratio = count / maxCount;
  
  if (ratio < 0.33) {
    return "hsl(142, 71%, 45%)";
  } else if (ratio < 0.67) {
    return "hsl(38, 92%, 50%)";
  } else {
    return "hsl(0, 84%, 60%)";
  }
}

function PosterMarker({ 
  posterData, 
  scanCount, 
  maxScanCount,
  index,
  onMouseDown
}: { 
  posterData: { qrCodeId: string; name: string; latitude: number; longitude: number };
  scanCount: number;
  maxScanCount: number;
  index: number;
  onMouseDown?: (qrCodeId: string) => void;
}) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  
  const color = getColorForScanCount(scanCount, maxScanCount);
  const size = Math.max(16, Math.min(32, 16 + (scanCount / maxScanCount) * 16));

  const handleActivatePoster = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (onMouseDown) {
      onMouseDown(posterData.qrCodeId);
    }
  };

  return (
    <div
      className="relative cursor-pointer group"
      role="button"
      tabIndex={0}
      aria-label={t("qrCode.posterAriaLabel", { id: posterData.qrCodeId })}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleActivatePoster}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivatePoster(e);
        }
      }}
      style={{
        animationDelay: `${index * 50}ms`,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div 
          className="rounded-full animate-ping"
          style={{
            width: `${size + 8}px`,
            height: `${size + 8}px`,
            backgroundColor: color,
            opacity: 0.15,
          }}
        />
      </div>
      
      <div className="relative flex items-center justify-center">
        <div className="relative">
          <div 
            className="absolute inset-0 rounded-full blur-md"
            style={{
              backgroundColor: color,
              opacity: 0.25,
              width: `${size + 4}px`,
              height: `${size + 4}px`,
              transform: 'translate(-50%, -50%)',
              top: '50%',
              left: '50%',
            }}
          />
          
          <div 
            className="relative rounded-full border-2 border-background shadow-lg transform transition-all duration-200 group-hover:scale-125"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: color,
            }}
          >
            <div 
              className="absolute rounded-full bg-white/40"
              style={{
                top: '20%',
                left: '20%',
                width: '30%',
                height: '30%',
              }}
            />
            
            {scanCount > 0 && size > 20 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span 
                  className="text-[10px] font-bold text-white drop-shadow-sm"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                >
                  {scanCount > 99 ? '99+' : scanCount}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-surface border border-border rounded-lg shadow-xl text-xs z-dropdown pointer-events-none min-w-[160px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <MapPin className="size-3 text-primary shrink-0" />
              <span className="text-foreground font-semibold truncate">
                {posterData.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="size-3 shrink-0" />
              <span>
                {t("qrCode.scanCount", { count: scanCount })}
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full size-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-border" />
        </div>
      )}
    </div>
  );
}

export function QRScanMap({ scans, posters, height = "500px", onMarkerClick }: QRScanMapProps) {
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

  // Group filtered scans by poster; marker positions come from QRCode, not scans.
  const posterLocations = useMemo(() => {
    const grouped = scans.reduce((acc, scan) => {
      if (!acc[scan.qrCodeId]) {
        acc[scan.qrCodeId] = [];
      }
      acc[scan.qrCodeId].push(scan);
      return acc;
    }, {} as Record<string, QRCodeScan[]>);

    return Object.entries(grouped).flatMap(([qrCodeId, posterScans]) => {
      const qrCode = posters.find(qr => qr.id === qrCodeId);

      if (!qrCode || qrCode.latitude === undefined || qrCode.longitude === undefined) {
        return [];
      }

      return [{
        qrCodeId,
        name: qrCode.name || t("qrCode.posterFallbackName", { id: qrCodeId.substring(0, 8) }),
        latitude: qrCode.latitude,
        longitude: qrCode.longitude,
        scanCount: posterScans.length,
      }];
    });
  }, [scans, posters, t]);

  const maxScanCount = useMemo(() => {
    return Math.max(...posterLocations.map(p => p.scanCount), 1);
  }, [posterLocations]);

  const center = useMemo(() => {
    if (posterLocations.length === 0) {
      return { latitude: 43.4723, longitude: -80.5449 }; // University of Waterloo
    }

    const avgLat = posterLocations.reduce((sum, p) => sum + p.latitude, 0) / posterLocations.length;
    const avgLng = posterLocations.reduce((sum, p) => sum + p.longitude, 0) / posterLocations.length;

    return { latitude: avgLat, longitude: avgLng };
  }, [posterLocations]);

  const mapStyle = isDarkMode
    ? "mapbox://styles/mapbox/dark-v11"
    : "mapbox://styles/mapbox/light-v11";

  const totalScans = scans.length;

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("example")) {
    return (
      <div
        className="w-full rounded-xl border border-border bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center shadow-sm"
        style={{ height }}
      >
        <div className="text-center p-8">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <MapPin className="size-8 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground mb-2">
            {t("qrCode.mapboxTokenMissingTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("qrCode.mapboxTokenMissingDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full rounded-xl border border-border overflow-hidden shadow-lg bg-surface" style={{ height }}>
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-card/95 via-card/80 to-transparent p-4 pointer-events-none">
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="size-2 bg-primary rounded-full animate-pulse" />
            <span className="text-xs font-medium text-foreground">
              {t("qrCode.posterCount", { count: posterLocations.length })} • {t("qrCode.totalScanCount", { count: totalScans })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50">
            <MapPin className="size-3 text-primary" />
            <span className="text-xs text-muted-foreground font-medium">
              {posterLocations.length > 0 ? t("common.active") : t("qrCode.noData")}
            </span>
          </div>
        </div>
      </div>

      <div className="w-full h-full">
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: center.longitude,
            latitude: center.latitude,
            zoom: posterLocations.length > 0 ? 14 : 13,
          }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={mapStyle}
          attributionControl={false}
        >
          {posterLocations.map((poster, index) => (
            <Marker
              key={poster.qrCodeId}
              longitude={poster.longitude}
              latitude={poster.latitude}
              anchor="center"
            >
              <PosterMarker 
                posterData={poster}
                scanCount={poster.scanCount}
                maxScanCount={maxScanCount}
                index={index}
                onMouseDown={onMarkerClick}
              />
            </Marker>
          ))}
        </Map>
      </div>

      {posterLocations.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-card/95 via-card/80 to-transparent p-4 pointer-events-none">
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pointer-events-auto flex-wrap">
            <div className="flex items-center gap-2 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50">
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-green-500" />
                <span>{t("qrCode.scanIntensityLow")}</span>
              </div>
              <span className="text-muted-foreground/50">→</span>
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-warning" />
                <span>{t("qrCode.scanIntensityMedium")}</span>
              </div>
              <span className="text-muted-foreground/50">→</span>
              <div className="flex items-center gap-1">
                <div className="size-2 rounded-full bg-destructive" />
                <span>{t("qrCode.scanIntensityHigh")}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50">
              <MapPin className="size-3" />
              <span>
                {center.latitude.toFixed(4)}, {center.longitude.toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
