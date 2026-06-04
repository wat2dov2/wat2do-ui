import { useState } from "react";
import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";
import { Search, Bookmark } from "lucide-react";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { LoadingPage } from "@/shared/ui/loading-page";
import { useClubsPage } from "@/features/clubs/hooks/useClubsPage";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useAuthState } from "@/features/auth";

export function ClubsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"all" | "followed">("all");
  const { isAuthenticated: authed } = useAuthState();
  const savedClubIds = useSavedClubsStore((s) => s.savedClubIds);

  const {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    toggleCategory,
    allCategories,
    filteredClubs,
    isLoading,
  } = useClubsPage();

  // Filter clubs shown in the active tab
  const displayClubs = activeTab === "followed"
    ? filteredClubs.filter((club) => savedClubIds.includes(club.id))
    : filteredClubs;

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
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("all")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === "all"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          id="tab-all-clubs"
        >
          {t("clubs.allClubs") || "All Clubs"}
        </button>
        <button
          onClick={() => setActiveTab("followed")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === "followed"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          id="tab-followed-clubs"
        >
          {t("clubs.followedClubs") || "Followed Clubs"}
        </button>
      </div>

      {/* Results Count / State Display */}
      {isLoading ? (
        <LoadingPage />
      ) : activeTab === "followed" && !authed ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 border border-dashed border-border rounded-2xl bg-card">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("clubs.signInToViewClubs") || "Sign in to view followed clubs"}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            {t("clubs.signInToViewClubsDesc") || "Follow clubs you're interested in and view them all in one place."}
          </p>
          <a
            href="/login"
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-xl text-sm hover:opacity-90 transition-opacity"
            id="followed-clubs-sign-in"
          >
            {t("events.signIn") || "Sign In"}
          </a>
        </div>
      ) : displayClubs.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xl text-foreground inline-flex items-baseline gap-1">
              <NumberFlow value={displayClubs.length} respectMotionPreference={false} />
              <span>{displayClubs.length === 1 ? t("clubs.club") : t("clubs.clubs")}</span>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
            {displayClubs.map((club) => (
              <ClubCard key={club.id} club={club} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 px-4 border border-dashed border-border rounded-2xl bg-card">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed" && savedClubIds.length === 0
              ? t("clubs.noFollowedClubs") || "No followed clubs"
              : t("clubs.noClubsFound") || "No clubs found"}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {activeTab === "followed" && savedClubIds.length === 0
              ? t("clubs.emptyClubsDesc") || "Follow clubs you're interested in and they'll appear here."
              : t("clubs.noClubsFoundDesc") || "We couldn't find any clubs matching your current filters."}
          </p>
        </div>
      )}
    </div>
  );
}

