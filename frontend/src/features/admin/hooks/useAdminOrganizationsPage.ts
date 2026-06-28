/**
 * Admin Organizations Page Hook
 * Manages state and logic for AdminOrganizationsPage.
 */

import { useCallback, useState } from "react";
import type { Organization } from "@/shared/types";
import { getAllOrganizations, getOrganizationTypes } from "@/features/organizations/api/organizations.api";
import { useEventsStore } from "@/features/events";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useOrganizationsList } from "@/features/organizations/hooks/useOrganizationsList";

interface UseAdminOrganizationsPageOptions {
  itemsPerPage?: number;
}

type OrganizationModalState =
  | { mode: "add" }
  | { mode: "edit"; organization: Organization }
  | null;

export function useAdminOrganizationsPage({ itemsPerPage = 20 }: UseAdminOrganizationsPageOptions = {}) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [selectedOrganizationType, setSelectedOrganizationTypeState] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [organizationModal, setOrganizationModal] = useState<OrganizationModalState>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);

  const showAddModal = organizationModal !== null;
  const editingOrganization = organizationModal?.mode === "edit" ? organizationModal.organization : null;

  const {
    organizations,
    totalItems,
    totalPages,
    isLoading,
    currentPage,
    setCurrentPage,
    refresh: refreshOrganizationsList,
  } = useOrganizationsList({
    limit: itemsPerPage,
    school: schoolFilter ?? undefined,
    search: submittedSearchQuery,
    organizationType: selectedOrganizationType,
  });

  const fetchTypes = useCallback(async () => {
    const allOrgs = await getAllOrganizations(schoolFilter ?? undefined);
    return getOrganizationTypes(allOrgs);
  }, [schoolFilter]);

  const { data: organizationTypes = [] } = useQuery({
    queryKey: queryKeys.organizations.adminTypes(schoolFilter, refreshCounter),
    queryFn: fetchTypes,
    placeholderData: [],
  });

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
  }, []);

  const submitSearchQuery = useCallback(() => {
    setSubmittedSearchQuery(searchQuery.trim());
    setCurrentPage(1);
  }, [searchQuery, setCurrentPage]);

  const clearSearchQuery = useCallback(() => {
    setSearchQueryState("");
    setSubmittedSearchQuery("");
    setCurrentPage(1);
  }, [setCurrentPage]);

  const setSelectedOrganizationType = useCallback((type: string) => {
    setSelectedOrganizationTypeState(type);
    setCurrentPage(1);
  }, [setCurrentPage]);

  return {
    // State
    searchQuery,
    selectedOrganizationType,
    deleteConfirmId,
    showAddModal,
    editingOrganization,
    currentPage,
    organizationTypes,
    organizations,
    totalItems,
    totalPages,
    isLoading,
    // Actions
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    setSelectedOrganizationType,
    setDeleteConfirmId,
    openAddModal: () => setOrganizationModal({ mode: "add" }),
    openEditModal: (org: Organization) => setOrganizationModal({ mode: "edit", organization: org }),
    closeModal: () => setOrganizationModal(null),
    setCurrentPage,
    refreshOrganizations: () => {
      void refreshOrganizationsList();
      setRefreshCounter((c) => c + 1);
    },
  };
}
