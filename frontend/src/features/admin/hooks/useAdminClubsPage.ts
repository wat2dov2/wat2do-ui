import { useCallback, useState } from "react";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import type { Club } from "@/shared/types";
import { useClubsList } from "@/features/clubs/hooks/useClubsList";

type ClubModalState =
  | { mode: "add" }
  | { mode: "edit"; club: Club }
  | null;

export function useAdminClubsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [clubType, setClubTypeFilter] = useState<string | undefined>();
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [clubModal, setClubModal] = useState<ClubModalState>(null);

  const showAddModal = clubModal !== null;
  const editingClub = clubModal?.mode === "edit" ? clubModal.club : null;

  const {
    clubs,
    totalItems,
    totalPages,
    isLoading,
    currentPage,
    setCurrentPage,
    refresh: refreshClubsList,
  } = useClubsList({
    limit: ADMIN_ITEMS_PER_PAGE,
    search: submittedSearchQuery,
    clubType,
  });

  const submitSearchQuery = useCallback(() => {
    setSubmittedSearchQuery(searchQuery.trim());
    setCurrentPage(1);
  }, [searchQuery, setCurrentPage]);

  const clearSearchQuery = useCallback(() => {
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setCurrentPage(1);
  }, [setCurrentPage]);

  const setClubType = useCallback((value: string | undefined) => {
    setClubTypeFilter(value);
    setCurrentPage(1);
  }, [setCurrentPage]);

  return {
    searchQuery,
    clubType,
    deleteConfirmId,
    showAddModal,
    editingClub,
    currentPage,
    clubs,
    totalItems,
    totalPages,
    isLoading,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    setClubType,
    setDeleteConfirmId,
    openAddModal: () => setClubModal({ mode: "add" }),
    openEditModal: (org: Club) => setClubModal({ mode: "edit", club: org }),
    closeModal: () => setClubModal(null),
    setCurrentPage,
    refreshClubs: () => {
      void refreshClubsList();
    },
  };
}
