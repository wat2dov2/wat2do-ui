import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { getAdminClubs, type AdminClub } from "@/features/admin/api/admin.api";
import { queryKeys } from "@/shared/lib/queryKeys";

type ClubModalState =
  | { mode: "add" }
  | { mode: "edit"; club: AdminClub }
  | null;

export function useAdminClubsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [clubType, setClubTypeFilter] = useState<string | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [clubModal, setClubModal] = useState<ClubModalState>(null);

  const showAddModal = clubModal !== null;
  const editingClub = clubModal?.mode === "edit" ? clubModal.club : null;

  const filters = { search: submittedSearchQuery, clubType, page: currentPage };
  const query = useQuery({
    queryKey: queryKeys.admin.list("clubs", filters),
    queryFn: () => getAdminClubs({ ...filters, limit: ADMIN_ITEMS_PER_PAGE }),
    retry: false,
  });

  const submitSearchQuery = useCallback(() => {
    setSubmittedSearchQuery(searchQuery.trim());
    setCurrentPage(1);
  }, [searchQuery]);

  const clearSearchQuery = useCallback(() => {
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setCurrentPage(1);
  }, []);

  const setClubType = useCallback((value: string | undefined) => {
    setClubTypeFilter(value);
    setCurrentPage(1);
  }, []);

  return {
    searchQuery,
    clubType,
    deleteConfirmId,
    showAddModal,
    editingClub,
    currentPage,
    clubs: query.data?.items ?? [],
    totalItems: query.data?.total ?? 0,
    totalPages: query.data?.total_pages ?? 0,
    isLoading: query.isLoading,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    setClubType,
    setDeleteConfirmId,
    openAddModal: () => setClubModal({ mode: "add" }),
    openEditModal: (club: AdminClub) => setClubModal({ mode: "edit", club }),
    closeModal: () => setClubModal(null),
    setCurrentPage,
  };
}
