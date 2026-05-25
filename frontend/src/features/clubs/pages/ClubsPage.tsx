import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";
import { Search } from "lucide-react";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { LoadingPage } from "@/shared/ui/loading-page";
import { useClubsPage } from "@/features/clubs/hooks/useClubsPage";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";

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
    <div className="-mt-6 space-y-4">
      {/* Search and filters stay pinned; -top-6 cancels AppLayout top padding when stuck. */}
      <div className="sticky -top-6 z-20 bg-background space-y-4 pt-6 pb-2 backdrop-blur-sm">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("clubs.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-border bg-secondary text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-border transition-all shadow-md"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <svg
                className="size-4"
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
          {!isLoading &&
            allCategories.slice(0, 10).map((category) => (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  selectedCategories.includes(category)
                    ? "bg-primary/80 text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {getClubCategoryTranslation(category, t)}
              </button>
            ))}
        </div>

        {/* Active Filters removed per design – chips above are sufficient */}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-foreground inline-flex items-baseline gap-1">
          <NumberFlow value={filteredClubs.length} />
          <span>{filteredClubs.length === 1 ? t("clubs.club") : t("clubs.clubs")}</span>
        </span>
      </div>

      {/* Clubs Grid */}
      {isLoading ? (
        <LoadingPage />
      ) : filteredClubs.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
          {filteredClubs.map((club) => (
            <ClubCard key={club.id} club={club} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Search className="size-8 text-muted-foreground" />
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
