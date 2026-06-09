/**
 * Admin Organizations Page Hook
 * Manages state and logic for AdminOrganizationsPage.
 */

import { useCallback, useMemo, useEffect, useState } from "react";
import type { Organization } from "@/shared/types";
import { loadAdminOrganizationsData } from "@/features/admin/api/admin.api";
import { filterOrganizations as filterOrganizationsSync } from "@/features/organizations";

interface UseAdminOrganizationsPageOptions {
  itemsPerPage?: number;
}

type OrganizationModalState =
  | { mode: "add" }
  | { mode: "edit"; organization: Organization }
  | null;

export function useAdminOrganizationsPage({ itemsPerPage = 20 }: UseAdminOrganizationsPageOptions = {}) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [selectedOrganizationType, setSelectedOrganizationTypeState] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [organizationModal, setOrganizationModal] = useState<OrganizationModalState>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationTypes, setOrganizationTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const showAddModal = organizationModal !== null;
  const editingOrganization = organizationModal?.mode === "edit" ? organizationModal.organization : null;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { clubs: loadedOrganizations, clubTypes: types } =
        await loadAdminOrganizationsData();
      setOrganizations(loadedOrganizations);
      setOrganizationTypes(types);
    } catch (error) {
      console.error("Failed to load admin organizations data:", error);
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

  const setSelectedOrganizationType = useCallback((type: string) => {
    setSelectedOrganizationTypeState(type);
    setCurrentPage(1);
  }, []);

  // Filter organizations synchronously — `filterOrganizationsSync` is a pure function, so
  // running it inside an async effect would introduce an extra render
  // cycle per keystroke. A `useMemo` is both correct and cheaper.
  const filteredOrganizations = useMemo<Organization[]>(() => {
    if (isLoading) return [];
    return filterOrganizationsSync(organizations, {
      searchQuery,
      clubType: selectedOrganizationType,
    });
  }, [organizations, searchQuery, selectedOrganizationType, isLoading]);

  // Pagination
  const totalPages = Math.ceil(filteredOrganizations.length / itemsPerPage);
  const paginatedOrganizations = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredOrganizations.slice(startIndex, endIndex);
  }, [filteredOrganizations, currentPage, itemsPerPage]);

  return {
    // State
    searchQuery,
    selectedClubType: selectedOrganizationType,
    deleteConfirmId,
    showAddModal,
    editingClub: editingOrganization,
    currentPage,
    clubTypes: organizationTypes,
    filteredOrganizations,
    paginatedClubs: paginatedOrganizations,
    totalPages,
    isLoading,
    // Actions
    setSearchQuery,
    setSelectedClubType: setSelectedOrganizationType,
    setDeleteConfirmId,
    openAddModal: () => setOrganizationModal({ mode: "add" }),
    openEditModal: (org: Organization) => setOrganizationModal({ mode: "edit", organization: org }),
    closeModal: () => setOrganizationModal(null),
    setCurrentPage,
    refreshClubs: loadData,
  };
}
