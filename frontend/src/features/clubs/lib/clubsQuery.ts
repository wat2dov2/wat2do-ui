export type ClubsListFilters = {
  limit: number;
  school?: string;
  search?: string;
  categories?: string[];
  clubType?: string;
  minEvents?: number;
  ids?: number[];
  isAuthenticated?: boolean;
  activeTab?: "all" | "followed" | "claimed";
  isSavedLoaded?: boolean;
};

export function stableClubsFilters(filters: ClubsListFilters): Record<string, unknown> {
  const {
    limit,
    school,
    search,
    categories,
    clubType,
    minEvents,
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
    clubType: clubType ?? "",
    minEvents: minEvents ?? 0,
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
