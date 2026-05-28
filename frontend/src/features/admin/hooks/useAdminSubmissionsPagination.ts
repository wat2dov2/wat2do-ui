import { useMemo, useState } from "react";
import type { EventSubmission } from "@/shared/types";

interface UseAdminSubmissionsPaginationOptions {
  filteredSubmissions: EventSubmission[];
  itemsPerPage: number;
}

export function useAdminSubmissionsPagination({
  filteredSubmissions,
  itemsPerPage,
}: UseAdminSubmissionsPaginationOptions) {
  const [currentPage, setCurrentPage] = useState(1);

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
