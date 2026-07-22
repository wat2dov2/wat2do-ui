export type OrganizationsListFilters = {
  limit: number;
  school?: string;
  search?: string;
  categories?: string[];
  associationAffiliated?: boolean;
  ids?: number[];
  isAuthenticated?: boolean;
  activeTab?: "all" | "followed" | "claimed";
  isSavedLoaded?: boolean;
};

export function stableOrganizationsFilters(filters: OrganizationsListFilters): Record<string, unknown> {
  const {
    limit,
    school,
    search,
    categories,
    associationAffiliated,
    ids,
    isAuthenticated,
    activeTab = "all",
    isSavedLoaded = true,
  } = filters;

  return {
    limit,
    school: school || "",
    search: search || "",
    categories: (categories || []).join(","),
    associationAffiliated: associationAffiliated ?? "",
    ...((activeTab === "followed" || activeTab === "claimed")
      ? {
          ids: (ids || []).join(","),
          isAuthenticated: Boolean(isAuthenticated),
          isSavedLoaded: Boolean(isSavedLoaded),
        }
      : {}),
    activeTab,
  };
}
