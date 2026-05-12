import { useState, useMemo, useEffect } from "react";
import type { QRCode, QRCodeScan } from "@/shared/types";

interface UsePostersPaginationOptions {
  itemsPerPage: number;
  scansPerPage: number;
  filteredQRCodes: QRCode[];
  scansMatchingPosterSearch: QRCodeScan[];
  timeFilter: string;
}

/**
 * Hook for managing pagination on a posters page.
 * Shared by admin and club-panel posters pages.
 */
export function usePostersPagination({
  itemsPerPage,
  scansPerPage,
  filteredQRCodes,
  scansMatchingPosterSearch,
  timeFilter,
}: UsePostersPaginationOptions) {
  const [postersPage, setPostersPage] = useState(1);
  const [scansPage, setScansPage] = useState(1);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPostersPage(1);
    setScansPage(1);
  }, [timeFilter]);

  // Paginate QR codes
  const paginatedQRCodes = useMemo(() => {
    const startIndex = (postersPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredQRCodes.slice(startIndex, endIndex);
  }, [filteredQRCodes, postersPage, itemsPerPage]);

  // Sort and paginate scans
  const sortedScans = useMemo(() => {
    return scansMatchingPosterSearch.toSorted(
      (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
    );
  }, [scansMatchingPosterSearch]);

  const paginatedScans = useMemo(() => {
    const startIndex = (scansPage - 1) * scansPerPage;
    const endIndex = startIndex + scansPerPage;
    return sortedScans.slice(startIndex, endIndex);
  }, [sortedScans, scansPage, scansPerPage]);

  const totalPostersPages = Math.ceil(filteredQRCodes.length / itemsPerPage);
  const totalScansPages = Math.ceil(sortedScans.length / scansPerPage);

  return {
    postersPage,
    setPostersPage,
    scansPage,
    setScansPage,
    paginatedQRCodes,
    paginatedScans,
    sortedScans,
    totalPostersPages,
    totalScansPages,
  };
}
