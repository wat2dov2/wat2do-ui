import React, { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Search, Megaphone, ArrowLeft, X, ChevronLeft, ChevronRight, Plus, MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
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
import { deleteQRCode } from "@/features/qrcode/api/qrcode.api";
import { QRCodeDetailsModal, CreateQRCodeModal } from "@/features/qrcode";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { useAdminContext } from "@/features/admin/context/AdminContext";
import { useAdminPostersFilters } from "@/features/admin/hooks/useAdminPostersFilters";
import { useAdminPostersPagination } from "@/features/admin/hooks/useAdminPostersPagination";
import { useAdminPostersStats } from "@/features/admin/hooks/useAdminPostersStats";
import { useAdminPostersPage } from "@/features/admin/hooks/useAdminPostersPage";
import { PostersTable } from "@/features/admin/components/PostersTable";
import type { QRCode } from "@/shared/types";

interface QRCodeWithStats extends QRCode {
  totalScans: number;
  uniqueScans: number;
  lastScanAt?: string;
}

// Lazy load Mapbox map component - it's heavy and only needed when visible
const QRScanMap = lazy(() => import("@/features/qrcode/components/QRScanMap").then(module => ({ default: module.QRScanMap })));

type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";

export function AdminPostersPage() {
  const { t } = useTranslation();
  const { events, userEmail, onBack } = useAdminContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    deleteConfirmId,
    setDeleteConfirmId,
    refreshKey,
    setRefreshKey,
    showCreateModal,
    setShowCreateModal,
  } = useAdminPostersPage();
  const POSTERS_PER_PAGE = 6;
  const SCANS_PER_PAGE = 14;
  
  // Intersection observer to only load map when it's about to be visible
  const { ref: mapContainerRef, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    threshold: 0.1,
    rootMargin: "200px",
  });

  // Use hooks for business logic
  const filters = useAdminPostersFilters({ refreshKey });
  const pagination = useAdminPostersPagination({
    itemsPerPage: POSTERS_PER_PAGE,
    scansPerPage: SCANS_PER_PAGE,
    filteredQRCodes: filters.filteredQRCodes,
    scansMatchingPosterSearch: filters.scansMatchingPosterSearch,
    searchQuery: filters.searchQuery,
    timeFilter: filters.timeFilter,
  });
  const stats = useAdminPostersStats({ qrCodes: filters.qrCodes });

  // Get qrCodeId from URL
  const qrCodeIdParam = searchParams.get("qrCodeId");
  const selectedQRCode = qrCodeIdParam
    ? filters.qrCodes.find((q) => q.id === qrCodeIdParam) || null
    : null;
  const showDetailsModal = selectedQRCode !== null;

  // Format timestamp for display
  const formatScanTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("common.justNow");
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleDelete = (id: string) => {
    deleteQRCode(id);
    setDeleteConfirmId(null);
    setRefreshKey((prev) => prev + 1);
  };

  const handleViewDetails = (qrCode: QRCodeWithStats) => {
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
          <h1 className="text-2xl font-bold text-gray-900">{t("admin.managePosters")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.managePostersDesc")}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
        <Input
          type="text"
          placeholder={t("admin.searchPosters")}
          value={filters.searchQuery}
          onChange={(e) => filters.setSearchQuery(e.target.value)}
          className="pl-9 pr-9"
        />
        {filters.searchQuery && (
          <button
            onClick={() => filters.setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Map and QR Code Scans Table Side by Side */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t("admin.scanLocations")}</h2>
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
                    style={{ height: "600px" }}
                  >
                    <div className="text-center p-8">
                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">{t("common.loadingMap")}</p>
                    </div>
                  </div>
                }
              >
                <QRScanMap
                  scans={filters.scansMatchingPosterSearch}
                  height="600px"
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
                style={{ height: "600px" }}
              >
                <div className="text-center p-8">
                  <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Map will load when visible</p>
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
                  {pagination.paginatedScans.length > 0 ? (
                    pagination.paginatedScans.map((scan) => (
                      <TableRow key={scan.id}>
                        <TableCell className="text-sm">
                          {formatScanTimestamp(scan.scannedAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {filters.qrCodeMap.get(scan.qrCodeId) || "Unknown"}
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

      {/* Posters Table - Below */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {filters.filteredQRCodes.length}{" "}
            {filters.filteredQRCodes.length === 1 ? t("admin.poster") : t("admin.posters")}
          </h2>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("admin.createPoster")}
          </Button>
        </div>
        {filters.filteredQRCodes.length > 0 ? (
          <PostersTable
            qrCodes={pagination.paginatedQRCodes}
            onViewDetails={handleViewDetails}
            onDelete={handleDelete}
            deleteConfirmId={deleteConfirmId}
            onDeleteClick={setDeleteConfirmId}
            formatScanTimestamp={formatScanTimestamp}
          />
        ) : (
          <div className="text-center py-12 text-muted-foreground border border-border rounded-xl">
            <p>{t("admin.noPostersFound")}</p>
          </div>
        )}
      </div>

      {/* Pagination for Posters */}
      {filters.filteredQRCodes.length > 0 && pagination.totalPostersPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {t("admin.showing")} {(pagination.postersPage - 1) * POSTERS_PER_PAGE + 1} {t("admin.to")}{" "}
            {Math.min(pagination.postersPage * POSTERS_PER_PAGE, filters.filteredQRCodes.length)} {t("common.of")}{" "}
            {filters.filteredQRCodes.length} {filters.filteredQRCodes.length === 1 ? t("admin.poster") : t("admin.posters")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.setPostersPage((prev) => Math.max(1, prev - 1))}
              disabled={pagination.postersPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              {t("admin.previous")}
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.totalPostersPages) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPostersPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.postersPage <= 3) {
                  pageNum = i + 1;
                } else if (pagination.postersPage >= pagination.totalPostersPages - 2) {
                  pageNum = pagination.totalPostersPages - 4 + i;
                } else {
                  pageNum = pagination.postersPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pagination.postersPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => pagination.setPostersPage(pageNum)}
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
              onClick={() => pagination.setPostersPage((prev) => Math.min(pagination.totalPostersPages, prev + 1))}
              disabled={pagination.postersPage === pagination.totalPostersPages}
            >
              {t("admin.next")}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.deletePoster")}</DialogTitle>
            <DialogDescription>
              {t("admin.deletePosterConfirm")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              {t("common.delete")}
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
          onUpdate={loadQRCodes}
        />
      )}

      {/* Create QR Code Modal */}
      <CreateQRCodeModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={() => {
          // Refresh the QR codes list
          loadQRCodes();
          setShowCreateModal(false);
        }}
        events={events}
        userEmail={userEmail}
      />
    </div>
  );
}
