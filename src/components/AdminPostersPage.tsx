import React, { useState, useMemo, Suspense, lazy, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Trash2, Megaphone, ArrowLeft, QrCode, Users, X, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { getQRCodes, deleteQRCode, getScansForQRCode, getQRScans } from "@/utils/qrRedirect";
import { QRCodeDetailsModal } from "./QRCodeDetailsModal";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import type { QRCode, Event, QRCodeScan } from "@/types";

// Lazy load Mapbox map component - it's heavy and only needed when visible
const QRScanMap = lazy(() => import("./QRScanMap").then(module => ({ default: module.QRScanMap })));

interface AdminPostersPageProps {
  onBack: () => void;
  events: Event[];
  userEmail: string;
}

type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";

export function AdminPostersPage({
  onBack,
  events,
  userEmail,
}: AdminPostersPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("alltime");
  const [postersPage, setPostersPage] = useState(1);
  const [scansPage, setScansPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  
  // Intersection observer to only load map when it's about to be visible
  const { ref: mapContainerRef, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    threshold: 0.1,
    rootMargin: "200px", // Start loading 200px before it's visible
  });

  // Get all QR codes (must be defined before selectedQRCode)
  const qrCodes = useMemo(() => {
    return getQRCodes();
  }, [refreshKey]);

  // Get qrCodeId from URL
  const qrCodeIdParam = searchParams.get("qrCodeId");
  const selectedQRCode = useMemo(() => {
    if (qrCodeIdParam) {
      return qrCodes.find((q) => q.id === qrCodeIdParam) || null;
    }
    return null;
  }, [qrCodeIdParam, qrCodes]);
  const showDetailsModal = selectedQRCode !== null;

  // Get all scans
  const allScans = useMemo(() => {
    return getQRScans();
  }, [refreshKey]);

  // Filter scans by time range
  const filteredScans = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate: Date | null = null;

    switch (timeFilter) {
      case "today":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
        break;
      case "yesterday":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(0, 0, 0, 0);
        break;
      case "last7days":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "last30days":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "alltime":
      default:
        return allScans;
    }

    return allScans.filter((scan) => {
      const scanDate = new Date(scan.scannedAt);
      if (endDate) {
        return scanDate >= startDate && scanDate <= endDate;
      }
      return scanDate >= startDate;
    });
  }, [allScans, timeFilter]);

  // Get QR code names for scans table
  const qrCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    qrCodes.forEach((qr) => map.set(qr.id, qr.name));
    return map;
  }, [qrCodes]);

  // Format timestamp for display
  const formatScanTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Calculate stats for each QR code
  const qrCodesWithStats = useMemo(() => {
    return qrCodes.map((qr) => {
      const scans = getScansForQRCode(qr.id);
      const uniqueScans = new Set(scans.map((s) => s.sessionId || s.userId || s.id)).size;
      return {
        ...qr,
        totalScans: scans.length,
        uniqueScans,
      };
    });
  }, [qrCodes]);

  // Filter QR codes
  const filteredQRCodes = useMemo(() => {
    return qrCodesWithStats.filter((qr) => {
      if (
        searchQuery &&
        !qr.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(qr.description || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    });
  }, [qrCodesWithStats, searchQuery]);

  // Filter scans by selected posters (search)
  const scansMatchingPosterSearch = useMemo(() => {
    // If there's no search query, keep all time-filtered scans
    if (!searchQuery) {
      return filteredScans;
    }

    const allowedIds = new Set(filteredQRCodes.map((qr) => qr.id));
    return filteredScans.filter((scan) => allowedIds.has(scan.qrCodeId));
  }, [filteredScans, filteredQRCodes, searchQuery]);

  // Latest scans for table (sorted by scannedAt descending)
  const sortedScans = useMemo(() => {
    return [...scansMatchingPosterSearch]
      .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());
  }, [scansMatchingPosterSearch]);

  // Pagination for posters
  const postersTotalPages = Math.ceil(filteredQRCodes.length / ITEMS_PER_PAGE);
  const paginatedPosters = useMemo(() => {
    const startIndex = (postersPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredQRCodes.slice(startIndex, endIndex);
  }, [filteredQRCodes, postersPage]);

  // Pagination for scans
  const scansTotalPages = Math.ceil(sortedScans.length / ITEMS_PER_PAGE);
  const paginatedScans = useMemo(() => {
    const startIndex = (scansPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return sortedScans.slice(startIndex, endIndex);
  }, [sortedScans, scansPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPostersPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setScansPage(1);
  }, [timeFilter]);

  const handleDelete = (id: string) => {
    deleteQRCode(id);
    setDeleteConfirmId(null);
    setRefreshKey((prev) => prev + 1);
  };

  const handleViewDetails = (qrCode: QRCode) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("qrCodeId", qrCode.id);
    setSearchParams(newParams);
  };

  const loadQRCodes = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Megaphone className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manage QR Code Posters</h1>
          <p className="text-sm text-muted-foreground">
            Manage QR code posters and track their performance
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
        <Input
          type="text"
          placeholder="Search posters..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Map Section - Lazy loaded only when visible */}
      <div ref={mapContainerRef} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Scan Locations</h2>
          <Select
            value={timeFilter}
            onValueChange={(value) => setTimeFilter(value as TimeFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="last7days">Last 7 Days</SelectItem>
              <SelectItem value="last30days">Last 30 Days</SelectItem>
              <SelectItem value="alltime">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasIntersected ? (
          <Suspense
            fallback={
              <div
                className="w-full rounded-lg border border-border bg-muted flex items-center justify-center"
                style={{ height: "500px" }}
              >
                <div className="text-center p-8">
                  <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Loading map...</p>
                </div>
              </div>
            }
          >
            <QRScanMap
              scans={scansMatchingPosterSearch}
              height="500px"
              onMarkerClick={(qrCodeId) => {
                const qrCode = qrCodes.find(qr => qr.id === qrCodeId);
                if (qrCode) {
                  handleViewDetails(qrCode);
                }
              }}
            />
          </Suspense>
        ) : (
          <div
            className="w-full rounded-lg border border-border bg-muted flex items-center justify-center"
            style={{ height: "500px" }}
          >
            <div className="text-center p-8">
              <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Map will load when visible</p>
            </div>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-gray-900">
          {filteredQRCodes.length}{" "}
          {filteredQRCodes.length === 1 ? "poster" : "posters"}
        </span>
      </div>

      {/* QR Codes Table */}
      {filteredQRCodes.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Picture</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total Scans</TableHead>
                <TableHead>Unique Scans</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedPosters.map((qr) => (
                <TableRow
                  key={qr.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleViewDetails(qr)}
                >
                  <TableCell>
                    {qr.imageUrl ? (
                      <img
                        src={qr.imageUrl}
                        alt={qr.name}
                        className="w-16 h-16 object-cover rounded"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded flex items-center justify-center">
                        <Megaphone className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-semibold">{qr.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {qr.description || "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        qr.isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {qr.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <QrCode className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{qr.totalScans}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{qr.uniqueScans}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(qr.id);
                        }}
                        className="text-error hover:text-error"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Pagination for Posters */}
      {filteredQRCodes.length > 0 && postersTotalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {(postersPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
            {Math.min(postersPage * ITEMS_PER_PAGE, filteredQRCodes.length)} of{" "}
            {filteredQRCodes.length} posters
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPostersPage((prev) => Math.max(1, prev - 1))}
              disabled={postersPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, postersTotalPages) }, (_, i) => {
                let pageNum: number;
                if (postersTotalPages <= 5) {
                  pageNum = i + 1;
                } else if (postersPage <= 3) {
                  pageNum = i + 1;
                } else if (postersPage >= postersTotalPages - 2) {
                  pageNum = postersTotalPages - 4 + i;
                } else {
                  pageNum = postersPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={postersPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPostersPage(pageNum)}
                    className="w-9"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPostersPage((prev) => Math.min(postersTotalPages, prev + 1))}
              disabled={postersPage === postersTotalPages}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {filteredQRCodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <QrCode className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No posters found
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No QR code posters match your current search.
          </p>
        </div>
      )}

      {/* Latest Scans Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Latest QR Code Scans</h2>
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>QR Code</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Session ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedScans.length > 0 ? (
                paginatedScans.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell className="text-sm">
                      {formatScanTimestamp(scan.scannedAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {qrCodeMap.get(scan.qrCodeId) || "Unknown"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {scan.userId || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {scan.sessionId.substring(0, 20)}...
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No scans found for the selected time period
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination for Scans */}
        {sortedScans.length > 0 && scansTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {(scansPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
              {Math.min(scansPage * ITEMS_PER_PAGE, sortedScans.length)} of{" "}
              {sortedScans.length} scans
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScansPage((prev) => Math.max(1, prev - 1))}
                disabled={scansPage === 1}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, scansTotalPages) }, (_, i) => {
                  let pageNum: number;
                  if (scansTotalPages <= 5) {
                    pageNum = i + 1;
                  } else if (scansPage <= 3) {
                    pageNum = i + 1;
                  } else if (scansPage >= scansTotalPages - 2) {
                    pageNum = scansTotalPages - 4 + i;
                  } else {
                    pageNum = scansPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={scansPage === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => setScansPage(pageNum)}
                      className="w-9"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScansPage((prev) => Math.min(scansTotalPages, prev + 1))}
                disabled={scansPage === scansTotalPages}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Poster</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this QR code poster? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Code Details Modal */}
      {selectedQRCode && (
        <QRCodeDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete("qrCodeId");
            setSearchParams(newParams);
          }}
          qrCode={selectedQRCode}
          events={events}
          userEmail={userEmail}
          onUpdate={loadQRCodes}
        />
      )}
    </div>
  );
}
