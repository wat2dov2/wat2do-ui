import { useState, useMemo } from "react";
import type { EventSubmission } from "@/shared/types";

interface UseAdminSubmissionsPaginationOptions {
  filteredSubmissions: EventSubmission[];
  searchQuery: string;
  statusFilter: string;
  itemsPerPage: number;
}

export function useAdminSubmissionsPagination({
  filteredSubmissions,
  searchQuery,
  statusFilter,
  itemsPerPage,
}: UseAdminSubmissionsPaginationOptions) {
  const [currentPage, setCurrentPage] = useState(1);
  const [prevFilters, setPrevFilters] = useState({ searchQuery, statusFilter });

  if (
    prevFilters.searchQuery !== searchQuery ||
    prevFilters.statusFilter !== statusFilter
  ) {
    setPrevFilters({ searchQuery, statusFilter });
    setCurrentPage(1);
  }

  const totalPages = Math.ceil(filteredSubmissions.length / itemsPerPage);
  const paginatedSubmissions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredSubmissions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredSubmissions, currentPage, itemsPerPage]);

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedSubmissions,
  };
}
