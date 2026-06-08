/**
 * Admin Clubs Page Hook
 * Manages state and logic for AdminOrganizationsPage.
 */

import { useCallback, useMemo, useEffect, useState } from "react";
import type { Club } from "@/shared/types";
import { loadAdminOrganizationsData } from "@/features/admin/api/admin.api";
import { filterOrganizations as filterOrganizationsSync } from "@/features/organizations";

interface UseAdminOrganizationsPageOptions {
  itemsPerPage?: number;
}

type ClubModalState =
  | { mode: "add" }
  | { mode: "edit"; club: Club }
  | null;

export function useAdminOrganizationsPage({ itemsPerPage = 20 }: UseAdminOrganizationsPageOptions = {}) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [selectedClubType, setSelectedClubTypeState] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [clubModal, setClubModal] = useState<ClubModalState>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubTypes, setClubTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const showAddModal = clubModal !== null;
  const editingClub = clubModal?.mode === "edit" ? clubModal.club : null;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { clubs: loadedClubs, clubTypes: types } =
        await loadAdminOrganizationsData();
      setClubs(loadedClubs);
      setClubTypes(types);
    } catch (error) {
      console.error("Failed to load admin clubs data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
    setCurrentPage(1);
  }, []);

  const setSelectedClubType = useCallback((type: string) => {
    setSelectedClubTypeState(type);
    setCurrentPage(1);
  }, []);

  // Filter clubs synchronously — `filterOrganizationsSync` is a pure function, so
  // running it inside an async effect would introduce an extra render
  // cycle per keystroke. A `useMemo` is both correct and cheaper.
  const filteredOrganizations = useMemo<Club[]>(() => {
    if (isLoading) return [];
    return filterOrganizationsSync(clubs, {
      searchQuery,
      clubType: selectedClubType,
    });
  }, [clubs, searchQuery, selectedClubType, isLoading]);

  // Pagination
  const totalPages = Math.ceil(filteredOrganizations.length / itemsPerPage);
  const paginatedClubs = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredOrganizations.slice(startIndex, endIndex);
  }, [filteredOrganizations, currentPage, itemsPerPage]);

  return {
    // State
    searchQuery,
    selectedClubType,
    deleteConfirmId,
    showAddModal,
    editingClub,
    currentPage,
    clubTypes,
    filteredOrganizations,
    paginatedClubs,
    totalPages,
    isLoading,
    // Actions
    setSearchQuery,
    setSelectedClubType,
    setDeleteConfirmId,
    openAddModal: () => setClubModal({ mode: "add" }),
    openEditModal: (club: Club) => setClubModal({ mode: "edit", club }),
    closeModal: () => setClubModal(null),
    setCurrentPage,
    refreshClubs: loadData,
  };
}
