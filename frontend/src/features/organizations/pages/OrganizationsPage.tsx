import { useState } from "react";
import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";
import { Search, Bookmark } from "lucide-react";
import { OrganizationCard } from "@/features/organizations/components/OrganizationCard";
import { OrganizationDetailsModal } from "@/features/organizations/components/OrganizationDetailsModal";
import { LoadingPage } from "@/shared/ui/loading-page";
import { useOrganizationsPage } from "@/features/organizations/hooks/useOrganizationsPage";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useAuthState } from "@/features/auth";
import type { Organization } from "@/shared/types";


export function OrganizationsPage() {
  const { t } = useTranslation();
  const { isAuthenticated: authed } = useAuthState();
  const savedOrganizationIds = useSavedOrganizationsStore((s) => s.savedOrganizationIds);
  const [activeTab, setActiveTab] = useState<"all" | "followed">("all");

  const {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    toggleCategory,
    allCategories,
    filteredOrganizations,
    isLoading,
  } = useOrganizationsPage();

  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);

  // Filter organizations shown in the active tab
  const displayOrgs = activeTab === "followed"
    ? filteredOrganizations.filter((club) => savedOrganizationIds.includes(club.id))
    : filteredOrganizations;

  return (
    <div className="-mt-6 space-y-4">
      {/* Search and filters stay pinned; -top-6 cancels AppLayout top padding when stuck. */}
      <div className="sticky -top-6 z-20 bg-background space-y-4 pt-6 pb-2 backdrop-blur-sm">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("organizations.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-border bg-secondary text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-border transition-all shadow-md"
          />
          {searchQuery && (
            <button
              onMouseDown={() => setSearchQuery("")}
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
                onMouseDown={() => toggleCategory(category)}
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
          onMouseDown={() => setActiveTab("all")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === "all"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          id="tab-all-clubs"
        >
          {t("organizations.allClubs") || "All Organizations"}
        </button>
        <button
          onMouseDown={() => setActiveTab("followed")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === "followed"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          id="tab-followed-clubs"
        >
          {t("organizations.followedClubs") || "Followed Organizations"}
        </button>
      </div>

      {/* Results Count / State Display */}
      {isLoading ? (
        <LoadingPage />
      ) : activeTab === "followed" && !authed ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl bg-card">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("organizations.signInToViewClubs") || "Sign in to view followed organizations"}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            {t("organizations.signInToViewClubsDesc") || "Follow organizations you're interested in and view them all in one place."}
          </p>
          <a
            href="/login"
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-xl text-sm hover:opacity-90 transition-opacity"
            id="followed-clubs-sign-in"
          >
            {t("events.signIn") || "Sign In"}
          </a>
        </div>
      ) : displayOrgs.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xl text-foreground inline-flex items-baseline gap-1">
              <NumberFlow value={displayOrgs.length} />
              <span>{displayOrgs.length === 1 ? "organization" : "organizations"}</span>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
            {displayOrgs.map((club) => (
              <OrganizationCard key={club.id} club={club} onMouseDown={() => setSelectedOrganization(club)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            {activeTab === "followed" ? (
              <Bookmark className="size-8 text-muted-foreground" />
            ) : (
              <Search className="size-8 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed" ? t("organizations.noFollowedClubs") : t("organizations.noClubsFound")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {activeTab === "followed" ? t("organizations.emptyClubsDesc") : t("organizations.noClubsFoundDesc")}
          </p>
        </div>
      )}

      <OrganizationDetailsModal
        club={selectedOrganization}
        isOpen={selectedOrganization !== null}
        onClose={() => setSelectedOrganization(null)}
      />
    </div>
  );
}
