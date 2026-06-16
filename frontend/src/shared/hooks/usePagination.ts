import { useMemo, useState } from "react";

interface UsePaginationOptions<T> {
  items: T[];
  itemsPerPage: number;
  initialPage?: number;
}

/**
 * usePagination Hook
 * Generic hook for managing in-memory (client-side) pagination.
 */
export function usePagination<T>({
  items,
  itemsPerPage,
  initialPage = 1,
}: UsePaginationOptions<T>) {
  const [currentPage, setCurrentPage] = useState(initialPage);

  const totalPages = Math.ceil(items.length / itemsPerPage);
  
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return items.slice(startIndex, startIndex + itemsPerPage);
  }, [items, currentPage, itemsPerPage]);

  // If the current page is out of bounds due to items list shrinking, adjust it
  const adjustedPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  if (currentPage !== adjustedPage) {
    setCurrentPage(adjustedPage);
  }

  return {
    currentPage: adjustedPage,
    setCurrentPage,
    totalPages,
    paginatedItems,
  };
}
