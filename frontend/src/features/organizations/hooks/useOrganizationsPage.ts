/**
 * Organizations Page Hook
 * Manages data loading and filtering for OrganizationsPage
 */

import { useState, useMemo, useCallback } from "react";
import type { Organization } from "@/shared/types";
import {
  loadOrganizationsData,
  filterOrganizations,
} from "@/features/organizations/api/organizations.api";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";
import { useEventsStore } from "@/features/events/store/events.store";

const EMPTY_DATA: { organizations: Organization[]; categories: string[] } = { organizations: [], categories: [] };

export function useOrganizationsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);

  const fetchOrganizations = useCallback(() => loadOrganizationsData(schoolFilter ?? undefined), [schoolFilter]);

  const { data, loading: isLoading } = useBackendQuery(fetchOrganizations, EMPTY_DATA, schoolFilter);
  const organizations = data.organizations;
  const allCategories = data.categories;

  // Derive filtered organizations from source data (no useState+useEffect sync needed)
  const filteredOrganizations = useMemo(() => {
    if (isLoading) return [];
    return filterOrganizations(organizations, {
      searchQuery,
      categories: selectedCategories,
    });
  }, [organizations, searchQuery, selectedCategories, isLoading]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    clubs: organizations,
    allCategories,
    filteredOrganizations,
    isLoading,
    toggleCategory,
  };
}
