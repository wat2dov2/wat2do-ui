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

export function useAdminOrganizationsPage({ itemsPerPage = 20 }: UseAdminOrganizationsPageOptions = {}) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [associationAffiliated, setAssociationAffiliatedState] = useState<boolean | undefined>(undefined);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [organizationModal, setOrganizationModal] = useState<OrganizationModalState>(null);
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
    associationAffiliated,
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

  const setAssociationAffiliated = useCallback((value: boolean | undefined) => {
    setAssociationAffiliatedState(value);
    setCurrentPage(1);
  }, [setCurrentPage]);

  return {
    searchQuery,
    associationAffiliated,
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
    setAssociationAffiliated,
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
