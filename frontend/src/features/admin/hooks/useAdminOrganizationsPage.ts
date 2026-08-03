import { useCallback, useState } from "react";
import type { Organization } from "@/shared/types";
import { useEventsStore } from "@/features/events";
import { useOrganizationsList } from "@/features/organizations/hooks/useOrganizationsList";

interface UseAdminOrganizationsPageOptions {
  itemsPerPage?: number;
}

type OrganizationModalState =
  | { mode: "add" }
  | { mode: "edit"; organization: Organization }
  | null;

interface OrganizationTypeFilter {
  school: string | undefined;
  value: string;
}

export function useAdminOrganizationsPage({ itemsPerPage = 20 }: UseAdminOrganizationsPageOptions = {}) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [organizationTypeFilter, setOrganizationTypeFilter] =
    useState<OrganizationTypeFilter | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [organizationModal, setOrganizationModal] = useState<OrganizationModalState>(null);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const organizationTypeSchool = schoolFilter ?? undefined;
  const organizationType =
    organizationTypeFilter?.school === organizationTypeSchool
      ? organizationTypeFilter.value
      : undefined;

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
    organizationType,
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

  const setOrganizationType = useCallback((value: string | undefined) => {
    setOrganizationTypeFilter(
      value ? { school: organizationTypeSchool, value } : null,
    );
    setCurrentPage(1);
  }, [organizationTypeSchool, setCurrentPage]);

  return {
    searchQuery,
    organizationType,
    deleteConfirmId,
    showAddModal,
    editingOrganization,
    currentPage,
    organizations,
    totalItems,
    totalPages,
    isLoading,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    setOrganizationType,
    setDeleteConfirmId,
    openAddModal: () => setOrganizationModal({ mode: "add" }),
    openEditModal: (org: Organization) => setOrganizationModal({ mode: "edit", organization: org }),
    closeModal: () => setOrganizationModal(null),
    setCurrentPage,
    refreshOrganizations: () => {
      void refreshOrganizationsList();
    },
  };
}
