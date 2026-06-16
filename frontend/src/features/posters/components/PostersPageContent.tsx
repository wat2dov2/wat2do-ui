/**
 * PostersPageContent -- shared posters page UI used by both admin and club-panel.
 *
 * Feature-specific components (QR scan map, QR details modal, QR asset wizard)
 * are passed in via props so this module has zero feature imports.
 */

import { Suspense, useMemo } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Megaphone, ArrowLeft, MapPin } from "@/shared/ui/doodle-icons";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Pagination } from "@/shared/ui/Pagination";
import { useBackendScans } from "@/features/posters/hooks/useBackendScans";
import { useBackendPosters } from "@/features/posters/hooks/useBackendPosters";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { usePagination } from "@/shared/hooks";
import { usePostersFilters } from "@/features/posters/hooks/usePostersFilters";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";
import type { Event } from "@/shared/types";
import type { QRCode, QRCodeScan } from "@/features/posters/types";
import { POSTER_MAP_HEIGHT } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";

type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";




/** Props for the lazy-loaded scan map component. */
interface ScanMapProps {
  scans: QRCodeScan[];
  posters: QRCode[];
  height: string;
  onMarkerClick: (qrCodeId: string) => void;
}

/** Props for the QR code details modal component. */
interface DetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
  events: Event[];
}

/** Props for the QR asset wizard component. */
interface AssetWizardProps {
  userEmail: string;
}

interface PostersPageContentProps {
  events: Event[];
  onBack: () => void;
  userEmail: string;
  /** Lazy-loaded scan map component. */
  ScanMapComponent: ComponentType<ScanMapProps>;
  /** QR code details modal component. */
  DetailsModalComponent: ComponentType<DetailsModalProps>;
  /** QR asset wizard component. */
  AssetWizardComponent: ComponentType<AssetWizardProps>;
}

export function PostersPageContent({
  events,
  onBack,
  userEmail,
  ScanMapComponent,
  DetailsModalComponent,
  AssetWizardComponent,
}: PostersPageContentProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const SCANS_PER_PAGE = 14;

  const { scans: backendScans, loading: scansLoading } = useBackendScans();
  const { posters: backendPosters, loading: postersLoading } = useBackendPosters();
  const isLoading = postersLoading || scansLoading;

  // Intersection observer to only load map when it's about to be visible
  const { ref: mapContainerRef, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    threshold: 0.1,
    rootMargin: "200px",
  });

  const filters = usePostersFilters({
    backendPosters,
    backendScans,
  });

  const sortedScans = useMemo(() => {
    return filters.scansMatchingPosterSearch.toSorted(
      (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
    );
  }, [filters.scansMatchingPosterSearch]);

  const scansPagination = usePagination({
    items: sortedScans,
    itemsPerPage: SCANS_PER_PAGE,
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
        <Button variant="secondary" size="icon" onMouseDown={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Megaphone className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("admin.qrAssets.title")}</h1>
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
            onValueChange={(value) => {
              filters.setTimeFilter(value as TimeFilter);
              scansPagination.setCurrentPage(1);
            }}
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
                    className="w-full rounded-lg border border-border bg-secondary flex items-center justify-center"
                    style={{ height: POSTER_MAP_HEIGHT }}
                  >
                    <div className="flex items-center justify-center gap-2 p-8">
                      <Spinner className="size-4" />
                      <p className="text-sm text-muted-foreground">{t("common.loadingMap")}</p>
                    </div>
                  </div>
                }
              >
                <ScanMapComponent
                  scans={filters.scansMatchingPosterSearch}
                  posters={filters.qrCodes}
                  height={POSTER_MAP_HEIGHT}
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
                className="w-full rounded-lg border border-border bg-secondary flex items-center justify-center"
                style={{ height: POSTER_MAP_HEIGHT }}
              >
                <div className="text-center p-8">
                  <MapPin className="size-12 text-muted-foreground/30 mx-auto mb-2" />
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
                  ) : scansPagination.paginatedItems.length > 0 ? (
                    scansPagination.paginatedItems.map((scan) => (
                      <TableRow key={scan.id}>
                        <TableCell className="text-sm">
                          {formatScanTimestamp(scan.scannedAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {filters.qrCodeMap.get(scan.qrCodeId) || t("admin.unknown")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {scan.userId || (
                            <span className="text-muted-foreground">&mdash;</span>
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
            {sortedScans.length > 0 && (
              <Pagination
                currentPage={scansPagination.currentPage}
                totalPages={scansPagination.totalPages}
                totalItems={sortedScans.length}
                itemsPerPage={SCANS_PER_PAGE}
                itemLabel={t("admin.scan")}
                itemLabelPlural={t("admin.scans")}
                onPageChange={scansPagination.setCurrentPage}
              />
            )}
          </div>
        </div>
      </div>

      {/* Generate QR Assets Wizard */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <AssetWizardComponent userEmail={userEmail} />
      </div>

      {/* QR Code Details Modal */}
      {selectedQRCode && (
        <DetailsModalComponent
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
