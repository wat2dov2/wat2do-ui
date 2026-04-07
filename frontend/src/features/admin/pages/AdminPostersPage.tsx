import React, { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Megaphone, ArrowLeft, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { QRCodeDetailsModal, useBackendScans, useBackendPosters, GenerateQRAssetsWizard } from "@/features/qrcode";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { useAdminContext } from "@/features/admin/context/AdminContext";
import { useAdminPostersFilters } from "@/features/admin/hooks/useAdminPostersFilters";
import { useAdminPostersPagination } from "@/features/admin/hooks/useAdminPostersPagination";
import { useAdminPostersPage } from "@/features/admin/hooks/useAdminPostersPage";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";
import type { QRCode } from "@/shared/types";
import { ADMIN_POSTERS_PER_PAGE } from "@/shared/constants/pagination";
import { ADMIN_MAP_HEIGHT } from "@/features/admin/constants";
import { QP } from "@/shared/constants/queryParams";

// Lazy load Mapbox map component - it's heavy and only needed when visible
const QRScanMap = lazy(() => import("@/features/qrcode/components/QRScanMap").then(module => ({ default: module.QRScanMap })));

type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";

export function AdminPostersPage() {
  const { t } = useTranslation();
  const { events, onBack } = useAdminContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    refreshKey,
    setRefreshKey,
  } = useAdminPostersPage();
  const SCANS_PER_PAGE = 14;

  const { scans: backendScans, loading: scansLoading } = useBackendScans(refreshKey);
  const { posters: backendPosters, loading: postersLoading } = useBackendPosters(refreshKey);
  const isLoading = postersLoading || scansLoading;

  // Intersection observer to only load map when it's about to be visible
  const { ref: mapContainerRef, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    threshold: 0.1,
    rootMargin: "200px",
  });

  const filters = useAdminPostersFilters({
    refreshKey,
    backendPosters,
    backendScans,
  });
  const pagination = useAdminPostersPagination({
    itemsPerPage: ADMIN_POSTERS_PER_PAGE,
    scansPerPage: SCANS_PER_PAGE,
    filteredQRCodes: filters.filteredQRCodes,
    scansMatchingPosterSearch: filters.scansMatchingPosterSearch,
    timeFilter: filters.timeFilter,
  });

  // Get qrCodeId from URL
  const qrCodeIdParam = searchParams.get(QP.QR_CODE_ID);
  const selectedQRCode = qrCodeIdParam
    ? filters.qrCodes.find((q) => q.id === qrCodeIdParam) || null
    : null;
  const showDetailsModal = selectedQRCode !== null;

  const formatScanTimestamp = (timestamp: string) => formatRelativeTimeCompact(timestamp, t);

  const handleViewDetails = (qrCode: QRCode) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set(QP.QR_CODE_ID, qrCode.id);
    setSearchParams(newParams);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Megaphone className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("admin.qrAssets.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.qrAssets.description")}
          </p>
        </div>
      </div>

      {/* Map and QR Code Scans Table Side by Side */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t("admin.scanLocations")}</h2>
          <Select
            value={filters.timeFilter}
            onValueChange={(value) => filters.setTimeFilter(value as TimeFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("filters.today")}</SelectItem>
              <SelectItem value="yesterday">{t("admin.yesterday")}</SelectItem>
              <SelectItem value="last7days">{t("qrCode.last7Days")}</SelectItem>
              <SelectItem value="last30days">{t("admin.last30Days")}</SelectItem>
              <SelectItem value="alltime">{t("admin.allTime")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-5">
          {/* Map Section - Left Side */}
          <div ref={mapContainerRef} className="space-y-3">
            {hasIntersected ? (
              <Suspense
                fallback={
                  <div
                    className="w-full rounded-lg border border-border bg-muted flex items-center justify-center"
                    style={{ height: ADMIN_MAP_HEIGHT }}
                  >
                    <div className="flex items-center justify-center gap-2 p-8">
                      <Spinner className="size-4" />
                      <p className="text-sm text-muted-foreground">{t("common.loadingMap")}</p>
                    </div>
                  </div>
                }
              >
                <QRScanMap
                  scans={filters.scansMatchingPosterSearch}
                  posters={filters.qrCodes}
                  height={ADMIN_MAP_HEIGHT}
                  onMarkerClick={(qrCodeId) => {
                    const qrCode = filters.qrCodes.find(qr => qr.id === qrCodeId);
                    if (qrCode) {
                      handleViewDetails(qrCode);
                    }
                  }}
                />
              </Suspense>
            ) : (
              <div
                className="w-full rounded-lg border border-border bg-muted flex items-center justify-center"
                style={{ height: ADMIN_MAP_HEIGHT }}
              >
                <div className="text-center p-8">
                  <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t("admin.mapWillLoadWhenVisible")}</p>
                </div>
              </div>
            )}
          </div>

          {/* QR Code Scans Table - Right Side */}
          <div className="space-y-3">
            <div className="border border-border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.timestamp")}</TableHead>
                    <TableHead>{t("admin.qrCode")}</TableHead>
                    <TableHead>{t("admin.userId")}</TableHead>
                    <TableHead>{t("admin.sessionId")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <Spinner className="size-4" />
                          <span>{t("common.loading")}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : pagination.paginatedScans.length > 0 ? (
                    pagination.paginatedScans.map((scan) => (
                      <TableRow key={scan.id}>
                        <TableCell className="text-sm">
                          {formatScanTimestamp(scan.scannedAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {filters.qrCodeMap.get(scan.qrCodeId) || t("admin.unknown")}
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
                        {t("admin.noScansFound")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination for Scans */}
            {pagination.sortedScans.length > 0 && pagination.totalScansPages > 1 && (
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {t("admin.showing")} {(pagination.scansPage - 1) * SCANS_PER_PAGE + 1} {t("admin.to")}{" "}
                  {Math.min(pagination.scansPage * SCANS_PER_PAGE, pagination.sortedScans.length)} {t("common.of")}{" "}
                  {pagination.sortedScans.length} {t("admin.scans")}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pagination.setScansPage((prev) => Math.max(1, prev - 1))}
                    disabled={pagination.scansPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t("admin.previous")}
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, pagination.totalScansPages) }, (_, i) => {
                      let pageNum: number;
                      if (pagination.totalScansPages <= 5) {
                        pageNum = i + 1;
                      } else if (pagination.scansPage <= 3) {
                        pageNum = i + 1;
                      } else if (pagination.scansPage >= pagination.totalScansPages - 2) {
                        pageNum = pagination.totalScansPages - 4 + i;
                      } else {
                        pageNum = pagination.scansPage - 2 + i;
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={pagination.scansPage === pageNum ? "default" : "outline"}
                          size="sm"
                          onClick={() => pagination.setScansPage(pageNum)}
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
                    onClick={() => pagination.setScansPage((prev) => Math.min(pagination.totalScansPages, prev + 1))}
                    disabled={pagination.scansPage === pagination.totalScansPages}
                  >
                    {t("admin.next")}
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Generate QR Assets Wizard */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <GenerateQRAssetsWizard />
      </div>

      {/* QR Code Details Modal */}
      {selectedQRCode && (
        <QRCodeDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete(QP.QR_CODE_ID);
            setSearchParams(newParams);
          }}
          qrCode={selectedQRCode}
          events={events}
        />
      )}

    </div>
  );
}
