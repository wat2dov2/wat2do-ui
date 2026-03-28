import React, { useMemo, useState, useEffect } from "react";
import Map from "react-map-gl/mapbox";
import { Marker } from "@vis.gl/react-mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { QRCode, QRCodeScan } from "@/shared/types";
import { MapPin, Zap } from "lucide-react";
import { listPostersFromBackend } from "@/features/qrcode/api/qrcode.api";

interface QRScanMapProps {
  scans: QRCodeScan[];
  /** When provided, used for poster names/locations; otherwise fetched from backend. */
  posters?: QRCode[];
  height?: string;
  onMarkerClick?: (qrCodeId: string) => void;
}

// Default Mapbox token - in production, this should come from environment variables
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "pk.eyJ1IjoibWFwYm94MTIzNDV0cSIsImEiOiJjbWI0NWdsN3gweHR4MnZweTE4emMwbmljIn0.hKl8l4kis1ZmQyjHe2kKqQ";

// Color scale based on scan count
// Industry standard: Green (low) -> Yellow (medium) -> Red (high)
// Hardcoded HSL values from Tailwind variables for reliability
function getColorForScanCount(count: number, maxCount: number): string {
  if (maxCount === 0) return "hsl(216, 100%, 42%)"; // Default primary blue
  
  // Normalize count to 0-1 range
  const ratio = count / maxCount;
  
  // Industry standard traffic light system:
  // Green (low/good) -> Yellow (medium/warning) -> Red (high/alert)
  // Using hardcoded HSL values from Tailwind variables:
  // green-500: hsl(142, 71%, 45%)
  // yellow-500: hsl(38, 92%, 50%)
  // red-500: hsl(0, 84%, 60%)
  if (ratio < 0.33) {
    // Low scans: Green
    return "hsl(142, 71%, 45%)";
  } else if (ratio < 0.67) {
    // Medium scans: Yellow
    return "hsl(38, 92%, 50%)";
  } else {
    // High scans: Red
    return "hsl(0, 84%, 60%)";
  }
}

// Custom branded marker component
function PosterMarker({ 
  posterData, 
  scanCount, 
  maxScanCount,
  index,
  onClick
}: { 
  posterData: { qrCodeId: string; name: string; latitude: number; longitude: number };
  scanCount: number;
  maxScanCount: number;
  index: number;
  onClick?: (qrCodeId: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  const color = getColorForScanCount(scanCount, maxScanCount);
  const size = Math.max(16, Math.min(32, 16 + (scanCount / maxScanCount) * 16));

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(posterData.qrCodeId);
    }
  };

  return (
    <div
      className="relative cursor-pointer group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      style={{
        animationDelay: `${index * 50}ms`,
      }}
    >
      {/* Pulse animation ring */}
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
      
      {/* Main marker */}
      <div className="relative flex items-center justify-center">
        <div className="relative">
          {/* Outer glow - reduced opacity */}
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
          
          {/* Marker dot - size based on scan count */}
          <div 
            className="relative rounded-full border-2 border-background shadow-lg transform transition-all duration-200 group-hover:scale-125"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: color,
            }}
          >
            {/* Inner highlight */}
            <div 
              className="absolute rounded-full bg-white/40"
              style={{
                top: '20%',
                left: '20%',
                width: '30%',
                height: '30%',
              }}
            />
            
            {/* Scan count badge for larger markers */}
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

      {/* Tooltip on hover */}
      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-card border border-border rounded-lg shadow-xl text-xs z-50 pointer-events-none min-w-[160px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-primary shrink-0" />
              <span className="text-foreground font-semibold truncate">
                {posterData.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="w-3 h-3 shrink-0" />
              <span>
                {scanCount} scan{scanCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-border" />
        </div>
      )}
    </div>
  );
}

export function QRScanMap({ scans, posters: postersProp, height = "500px", onMarkerClick }: QRScanMapProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [fetchedPosters, setFetchedPosters] = useState<QRCode[]>([]);

  // Use provided posters or fetch from backend
  useEffect(() => {
    if (postersProp !== undefined) return;
    let cancelled = false;
    listPostersFromBackend()
      .then((list) => { if (!cancelled) setFetchedPosters(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [postersProp]);

  const qrCodes = useMemo(() => postersProp ?? fetchedPosters, [postersProp, fetchedPosters]);

  // Detect dark mode
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

  // Group FILTERED scans by QR code (poster) to get scan counts for the time period
  // Use poster locations from QRCode (not from scans)
  const posterLocations = useMemo(() => {
    // Group filtered scans by qrCodeId to count scans in the time period
    const grouped = scans.reduce((acc, scan) => {
      if (!acc[scan.qrCodeId]) {
        acc[scan.qrCodeId] = [];
      }
      acc[scan.qrCodeId].push(scan);
      return acc;
    }, {} as Record<string, QRCodeScan[]>);

    // Use poster locations from QRCode and filtered scan counts
    return Object.entries(grouped).map(([qrCodeId, posterScans]) => {
      const qrCode = qrCodes.find(qr => qr.id === qrCodeId);
      
      // Skip if QR code not found or doesn't have location
      if (!qrCode || qrCode.latitude === undefined || qrCode.longitude === undefined) {
        return null;
      }
      
      return {
        qrCodeId,
        name: qrCode.name || `Poster ${qrCodeId.substring(0, 8)}`,
        latitude: qrCode.latitude,
        longitude: qrCode.longitude,
        scanCount: posterScans.length,
      };
    }).filter((poster): poster is NonNullable<typeof poster> => poster !== null);
  }, [scans, qrCodes]);

  // Find max scan count for color scaling
  const maxScanCount = useMemo(() => {
    return Math.max(...posterLocations.map(p => p.scanCount), 1);
  }, [posterLocations]);

  // Calculate center point from all poster locations
  const center = useMemo(() => {
    if (posterLocations.length === 0) {
      return { latitude: 43.4723, longitude: -80.5449 }; // University of Waterloo
    }

    const avgLat = posterLocations.reduce((sum, p) => sum + p.latitude, 0) / posterLocations.length;
    const avgLng = posterLocations.reduce((sum, p) => sum + p.longitude, 0) / posterLocations.length;

    return { latitude: avgLat, longitude: avgLng };
  }, [posterLocations]);

  // Choose map style based on theme
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
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-8 h-8 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground mb-2">
            Mapbox token not configured
          </p>
          <p className="text-xs text-muted-foreground">
            Please set VITE_MAPBOX_TOKEN in your environment variables
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full rounded-xl border border-border overflow-hidden shadow-lg bg-card" style={{ height }}>
      {/* Header overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-card/95 via-card/80 to-transparent p-4 pointer-events-none">
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-xs font-medium text-foreground">
              {posterLocations.length} poster{posterLocations.length !== 1 ? "s" : ""} • {totalScans} total scan{totalScans !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50">
            <MapPin className="w-3 h-3 text-primary" />
            <span className="text-xs text-muted-foreground font-medium">
              {posterLocations.length > 0 ? "Active" : "No data"}
            </span>
          </div>
        </div>
      </div>

      {/* Map container */}
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
                onClick={onMarkerClick}
              />
            </Marker>
          ))}
        </Map>
      </div>

      {/* Legend/Stats overlay at bottom */}
      {posterLocations.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-card/95 via-card/80 to-transparent p-4 pointer-events-none">
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pointer-events-auto flex-wrap">
            <div className="flex items-center gap-2 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>Low</span>
              </div>
              <span className="text-muted-foreground/50">→</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <span>Medium</span>
              </div>
              <span className="text-muted-foreground/50">→</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-error" />
                <span>High</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50">
              <MapPin className="w-3 h-3" />
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
