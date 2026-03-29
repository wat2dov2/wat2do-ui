import { useState, useMemo, useEffect } from "react";
import type { EventSubmission } from "@/shared/types";

interface UseAdminSubmissionsPaginationOptions {
  filteredSubmissions: EventSubmission[];
  searchQuery: string;
  statusFilter: string;
  itemsPerPage: number;
}

/**
 * Hook for managing pagination in AdminSubmissionsPage
 */
export function useAdminSubmissionsPagination({
  filteredSubmissions,
  searchQuery,
  statusFilter,
  itemsPerPage,
}: UseAdminSubmissionsPaginationOptions) {
  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 when filters change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  // Paginate submissions
  const totalPages = Math.ceil(filteredSubmissions.length / itemsPerPage);
  const paginatedSubmissions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredSubmissions.slice(startIndex, endIndex);
  }, [filteredSubmissions, currentPage, itemsPerPage]);

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedSubmissions,
  };
}
