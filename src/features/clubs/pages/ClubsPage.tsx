import React from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { useClubsPage } from "@/features/clubs/hooks/useClubsPage";

// Normalize club category to use consolidated event category translations where applicable
function getClubCategoryTranslation(category: string, t: (key: string) => string): string {
  const categoryMap: Record<string, string> = {
    "Academic": "categories.academic",
    "Religious": "categories.religious",
    "Cultural": "categories.cultural",
  };
  const normalizedKey = categoryMap[category];
  if (normalizedKey) {
    return t(normalizedKey) || category;
  }
  // Fallback to clubs.categories.* for WUSA-specific categories
  return t(`clubs.categories.${category}`) || category;
}

export function ClubsPage() {
  const { t } = useTranslation();
  const {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    toggleCategory,
    allCategories,
    filteredClubs,
    isLoading,
  } = useClubsPage();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("navigation.clubs")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("clubs.description")}
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("clubs.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-border bg-muted text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all shadow-md"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Category Chips */}
          {!isLoading && allCategories.slice(0, 10).map((category) => (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                selectedCategories.includes(category)
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-gray-200"
              }`}
            >
              {getClubCategoryTranslation(category, t)}
            </button>
          ))}
        </div>

        {/* Active Filters */}
        {selectedCategories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t("clubs.activeFilters")}:</span>
            {selectedCategories.map((cat) => (
              <Badge
                key={cat}
                variant="secondary"
                className="text-xs px-2 py-0.5 rounded-xl"
              >
                {getClubCategoryTranslation(cat, t)}
                <button
                  onClick={() => toggleCategory(cat)}
                  className="ml-1.5 hover:text-foreground"
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-gray-900">
          {filteredClubs.length} {filteredClubs.length === 1 ? t("clubs.club") : t("clubs.clubs")}
        </span>
      </div>

      {/* Clubs Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-muted-foreground">{t("common.loadingPage")}</div>
        </div>
      ) : filteredClubs.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
          {filteredClubs.map((club) => (
            <ClubCard key={club.id} club={club} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("clubs.noClubsFound")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {t("clubs.noClubsFoundDesc")}
          </p>
        </div>
      )}
    </div>
  );
}
