import { Suspense, useMemo } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "@/shared/ui/doodle-icons";
import { Spinner } from "@/shared/ui/spinner";
import { FormGrid, Stack } from "@/shared/layout";
import { Card, CardContent } from "@/shared/ui/card";
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
import { useBackendScans } from "@/features/posters/hooks/useBackendScans";
import { useBackendPosters } from "@/features/posters/hooks/useBackendPosters";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { usePagination } from "@/shared/hooks";
import { usePostersFilters, type TimeFilter } from "@/features/posters/hooks/usePostersFilters";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";
import type { PosterMapMarker, QRCode } from "@/features/posters/types";
import { POSTER_MAP_HEIGHT } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { buildManagedPosterMapMarkers } from "@/features/posters/utils/posterMapMarkers";

/** Props for the lazy-loaded scan map component. */
interface ScanMapProps {
  markers: PosterMapMarker[];
  height: string;
  onMarkerClick: (qrCodeId: string) => void;
}

/** Props for the QR code details modal component. */
interface DetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
}

/** Props for the QR asset wizard component. */
interface AssetWizardProps {
  userEmail: string;
}

interface PostersPageContentProps {
  school: string | null;
  userEmail: string;
  /** Lazy-loaded scan map component. */
  ScanMapComponent: ComponentType<ScanMapProps>;
  /** QR code details modal component. */
  DetailsModalComponent: ComponentType<DetailsModalProps>;
  /** QR asset wizard component. */
  AssetWizardComponent: ComponentType<AssetWizardProps>;
}

export function PostersPageContent({
  school,
  userEmail,
  ScanMapComponent,
  DetailsModalComponent,
  AssetWizardComponent,
}: PostersPageContentProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const SCANS_PER_PAGE = 14;

  const { scans: backendScans, loading: scansLoading } = useBackendScans();
  const { posters: backendPosters, loading: postersLoading } = useBackendPosters(school);
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
    return filters.filteredScans.toSorted(
      (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
    );
  }, [filters.filteredScans]);
  const mapMarkers = useMemo(
    () =>
      buildManagedPosterMapMarkers(
        backendPosters,
        filters.filteredScans,
      ),
    [backendPosters, filters.filteredScans],
  );

  const scansPagination = usePagination({
    items: sortedScans,
    itemsPerPage: SCANS_PER_PAGE,
  });

  const qrCodeIdParam = searchParams.get(QP.QR_CODE_ID);
  const selectedQRCode = qrCodeIdParam
    ? backendPosters.find((q) => q.id === qrCodeIdParam) || null
    : null;
  const showDetailsModal = selectedQRCode !== null;

  const formatScanTimestamp = (timestamp: string) =>
    formatRelativeTimeCompact(timestamp, t);

  const handleViewDetails = (qrCode: QRCode) => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set(QP.QR_CODE_ID, qrCode.id);
    setSearchParams(newParams);
  };

  return (
    <Stack gap={5}>
      <Stack gap={3}>
        <Stack direction="horizontal" align="center" justify="between">
          <h2 className="text-lg font-semibold text-foreground">
            {t("admin.scanLocations")}
          </h2>
          <Select
            value={filters.timeFilter}
            onValueChange={(value) => {
              filters.setTimeFilter(value as TimeFilter);
              scansPagination.setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-11 w-[180px]">
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
        </Stack>
        <FormGrid columns={2}>
          <div ref={mapContainerRef}>
            <Stack gap={3}>
              {hasIntersected ? (
                <Suspense
                  fallback={
                    <Stack
                      align="center"
                      justify="center"
                      className="w-full rounded-lg border border-border bg-secondary"
                      style={{ height: POSTER_MAP_HEIGHT }}
                    >
                      <Stack
                        direction="horizontal"
                        align="center"
                        justify="center"
                        gap={2}
                        className="p-8"
                      >
                        <Spinner className="size-4" />
                        <p className="text-sm text-muted-foreground">
                          {t("common.loadingMap")}
                        </p>
                      </Stack>
                    </Stack>
                  }
                >
                  <ScanMapComponent
                    markers={mapMarkers}
                    height={POSTER_MAP_HEIGHT}
                    onMarkerClick={(qrCodeId) => {
                      const qrCode = backendPosters.find(
                        (candidate) => candidate.id === qrCodeId,
                      );
                      if (qrCode) {
                        handleViewDetails(qrCode);
                      }
                    }}
                  />
                </Suspense>
              ) : (
                <Stack
                  align="center"
                  justify="center"
                  className="w-full rounded-lg border border-border bg-secondary"
                  style={{ height: POSTER_MAP_HEIGHT }}
                >
                  <Stack
                    align="center"
                    gap={2}
                    className="p-8 text-center"
                  >
                    <MapPin className="size-12 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      {t("admin.mapWillLoadWhenVisible")}
                    </p>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </div>

          <Stack gap={3}>
            <Table pagination={{ currentPage: scansPagination.currentPage, totalPages: scansPagination.totalPages, onPageChange: scansPagination.setCurrentPage }}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.timestamp")}</TableHead>
                  <TableHead>{t("admin.qrCode")}</TableHead>
                  <TableHead>{t("admin.browserFamily")}</TableHead>
                  <TableHead>{t("admin.osFamily")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      <Stack
                        direction="horizontal"
                        align="center"
                        justify="center"
                        gap={2}
                      >
                        <Spinner className="size-4" />
                        <span>{t("common.loading")}</span>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ) : scansPagination.paginatedItems.length > 0 ? (
                  scansPagination.paginatedItems.map((scan) => (
                    <TableRow key={scan.id}>
                      <TableCell className="text-sm">
                        {formatScanTimestamp(scan.scannedAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {filters.qrCodeMap.get(scan.qrCodeId) ||
                          t("admin.unknown")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {scan.browserFamily || (
                          <span className="text-muted-foreground">
                            &mdash;
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {scan.osFamily || (
                          <span className="text-muted-foreground">
                            &mdash;
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      {t("admin.noScansFound")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Stack>
        </FormGrid>
      </Stack>

      <Card>
        <CardContent>
          <AssetWizardComponent userEmail={userEmail} />
        </CardContent>
      </Card>

      {selectedQRCode && (
        <DetailsModalComponent
          isOpen={showDetailsModal}
          onClose={() => {
            const newParams = new URLSearchParams(searchParams.toString());
            newParams.delete(QP.QR_CODE_ID);
            setSearchParams(newParams);
          }}
          qrCode={selectedQRCode}
        />
      )}
    </Stack>
  );
}
