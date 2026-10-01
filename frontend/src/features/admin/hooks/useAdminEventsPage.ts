import { useState } from "react";
import { getAdminEventsPage } from "@/features/admin/api/admin.api";
import { useAdminList } from "@/features/admin/hooks/useAdminList";
import { getAppConstantsSnapshot } from "@/shared/api/metaApi";

export function useAdminEventsPage(enabled: boolean) {
  const list = useAdminList("events", getAdminEventsPage, enabled);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  return {
    events: list.items, total: list.total, isLoadingEvents: list.isPending,
    error: list.isError,
    retry: () => { void list.refetch(); },
    searchQuery: list.filters.search ?? "", selectedCategory: list.filters.category ?? "",
    categories: getAppConstantsSnapshot().event_categories,
    currentPage: list.pagination.currentPage, totalPages: list.pagination.totalPages,
    setCurrentPage: list.pagination.onPageChange,
    setSearchQuery: (search: string) => list.setFilters({ search }),
    setSelectedCategory: (category: string) => list.setFilters({ category }),
    deleteConfirmId, setDeleteConfirmId,
    selectedEventId,
    selectedEvent: list.items.find(event => event.id === selectedEventId) ?? null,
    selectEvent: setSelectedEventId, clearSelectedEvent: () => setSelectedEventId(null),
  };
}
