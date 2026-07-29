/**
 * Organizations Page Hook
 * Manages data loading and filtering for OrganizationsPage
 */

import { useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEventsStore } from "@/features/events/store/events.store";
import { getOrganizationCategories } from "@/shared/data/organizationCategories";
import { resolveSchool } from "@/shared/constants/schools";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useAuthState } from "@/features/auth";
import { useOrganizationsList } from "@/features/organizations/hooks/useOrganizationsList";
import type { PaginatedOrganizationsResponse } from "@/features/organizations/api/organizations.api";
import { controlBox } from "@/shared/config/controlBox";

interface UseOrganizationsPageOptions {
  initialDirectory: PaginatedOrganizationsResponse | null;
  initialSchool: string;
}

export function useOrganizationsPage({
  initialDirectory,
  initialSchool,
}: UseOrganizationsPageOptions) {
  const { isAuthenticated, clubs: claimedClubs } = useAuthState();
  const claimedOrganizationIds = useMemo(() => claimedClubs.map((c) => c.id), [claimedClubs]);
  const savedOrganizationIds = useSavedOrganizationsStore(useShallow((s) => s.savedOrganizationIds));
  const [activeTab, setActiveTab] = useState<"all" | "followed" | "claimed">("all");
  const [searchQuery, setSearchQueryState] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const resolvedSchoolFilter = schoolFilter ? resolveSchool(schoolFilter) : undefined;

  const allCategories = getOrganizationCategories();

  const isSavedLoaded = useSavedOrganizationsStore((s) => s.hasLoaded);

  const {
    organizations,
    totalItems,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh: refreshOrganizations,
  } = useOrganizationsList({
    mode: "infinite",
    limit: controlBox.organizationManagement.directoryPageSize,
    school: resolvedSchoolFilter,
    search: submittedSearchQuery,
    categories: selectedCategories,
    ids: activeTab === "followed" ? savedOrganizationIds : (activeTab === "claimed" ? claimedOrganizationIds : undefined),
    isAuthenticated,
    activeTab,
    isSavedLoaded: activeTab === "followed" ? isSavedLoaded : true,
    initialDirectory,
    initialSchool,
  });

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
  }, []);

  const submitSearchQuery = useCallback(() => {
    setSubmittedSearchQuery(searchQuery.trim());
  }, [searchQuery]);

  const clearSearchQuery = useCallback(() => {
    setSearchQueryState("");
    setSubmittedSearchQuery("");
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    selectedCategories,
    setSelectedCategories: (cats: string[]) => {
      setSelectedCategories(cats);
    },
    organizations,
    allCategories,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    toggleCategory,
    totalItems,
    refreshOrganizations,
    activeTab,
    setActiveTab: (tab: "all" | "followed" | "claimed") => {
      setActiveTab(tab);
    },
  };
}
