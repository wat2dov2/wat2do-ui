import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";
import { Bookmark, Search, Users, Instagram, MessageCircle } from "@/shared/ui/doodle-icons";
import { OrganizationDetailsModal } from "@/features/organizations/components/OrganizationDetailsModal";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { useOrganizationsPage } from "@/features/organizations/hooks/useOrganizationsPage";
import { translateCategory } from "@/shared/utils/event";
import { useAuthState } from "@/features/auth";
import type { Organization } from "@/shared/types";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { TableCell, TableRow } from "@/shared/ui/table";
import { Pagination } from "@/shared/ui/Pagination";
import { sanitizeHref } from "@/shared/utils/url";
import { OrganizationCategoryBadges } from "@/features/organizations/components/OrganizationCategoryBadges";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";


export function OrganizationsPage() {
  const { t } = useTranslation();
  const { isAuthenticated: authed } = useAuthState();

  const {
    searchQuery,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    selectedCategories,
    toggleCategory,
    allCategories,
    organizations,
    isLoading,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    activeTab,
    setActiveTab,
  } = useOrganizationsPage();

  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleRowPointerDown = (e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleRowClick = (club: Organization, e: React.MouseEvent) => {
    const start = pointerStartRef.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 10) return;
    }
    setSelectedOrganization(club);
  };

  return (
    <div className="-mt-4 space-y-4">
      {/* Search and filters stay pinned; -top-4 cancels AppLayout top padding when stuck. */}
      <div className="sticky -top-4 z-20 bg-background space-y-4 pt-4 pb-2 backdrop-blur-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          {/* Search Bar */}
          <SubmittedSearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={submitSearchQuery}
            onClear={clearSearchQuery}
            placeholder={t("organizations.searchPlaceholder")}
            submitLabel={t("common.search")}
            clearLabel={t("organizations.clearSearch")}
          />

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "all" | "followed" | "claimed")}
            className="shrink-0"
          >
            <TabsList className="h-8">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="all"
                    id="tab-all-clubs"
                    className="h-7 px-3 py-0 text-xs"
                    aria-label={t("organizations.allClubs") || "All"}
                  >
                    <span>{t("organizations.allClubs") || "All"}</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("organizations.allClubs") || "All"}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="followed"
                    id="tab-followed-clubs"
                    className="h-7 px-3 py-0 text-xs"
                    aria-label={t("organizations.followedClubs") || "Followed"}
                  >
                    <span>{t("organizations.followedClubs") || "Followed"}</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("organizations.followedClubs") || "Followed"}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="claimed"
                    id="tab-claimed-clubs"
                    className="h-7 px-3 py-0 text-xs"
                    aria-label={t("organizations.claimedClubs") || "Claimed"}
                  >
                    <span>{t("organizations.claimedClubs") || "Claimed"}</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("organizations.claimedClubs") || "Claimed"}</p>
                </TooltipContent>
              </Tooltip>
            </TabsList>
          </Tabs>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Category Chips */}
          {allCategories.map((category) => (
            <button
              key={category}
              onMouseDown={() => toggleCategory(category)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                selectedCategories.includes(category)
                  ? "bg-primary/80 text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {translateCategory(category, t)}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count and Pagination */}
      {!((activeTab === "followed" || activeTab === "claimed") && !authed) && (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap w-full">
          <span className="font-bold text-base text-foreground inline-flex items-baseline gap-1">
            <NumberFlow value={totalItems} respectMotionPreference={false} />
            <span>{totalItems === 1 ? t("organizations.organizationLabel") : t("organizations.organizationLabel_other")}</span>
          </span>
          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              itemsPerPage={itemsPerPage}
              itemLabel={t("admin.club")}
              itemLabelPlural={t("navigation.organizations")}
              onPageChange={setCurrentPage}
              hideDetails
            />
          )}
        </div>
      )}

      {/* Results / Loading / State Display */}
      {isLoading ? (
        <LoadingPage />
      ) : (activeTab === "followed" || activeTab === "claimed") && !authed ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl bg-card">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed"
              ? (t("organizations.signInToViewClubs") || "Sign in to view followed organizations")
              : (t("organizations.signInToViewClaimedClubs") || "Sign in to view claimed organizations")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            {activeTab === "followed"
              ? (t("organizations.signInToViewClubsDesc") || "Follow organizations you're interested in and view them all in one place.")
              : (t("organizations.signInToViewClaimedClubsDesc") || "Manage and view your claimed organizations all in one place.")}
          </p>
          <a
            href="/login"
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-xl text-sm hover:opacity-90 transition-opacity"
            id={activeTab === "followed" ? "followed-clubs-sign-in" : "claimed-clubs-sign-in"}
          >
            {t("events.signIn") || "Sign In"}
          </a>
        </div>
      ) : organizations.length > 0 ? (
        <div className="space-y-4">

          <AdminTable
            headers={[
              { label: t("forms.organizationName") },
              { label: t("forms.categories"), className: "hidden sm:table-cell" },
              { label: t("forms.organizationType"), className: "hidden md:table-cell" },
              { label: <span className="flex items-center gap-1.5"><Instagram className="size-3.5" />{t("admin.instagram")}</span>, className: "hidden sm:table-cell" },
              { label: <span className="flex items-center gap-1.5"><MessageCircle className="size-3.5" />{t("admin.discord")}</span>, className: "hidden md:table-cell" },
            ]}
          >
            {organizations.map((club) => {
              return (
                <TableRow
                  key={club.id}
                  className="cursor-pointer"
                  onPointerDown={handleRowPointerDown}
                  onClick={(event) => handleRowClick(club, event)}
                >
                  {/* Name */}
                  <TableCell>
                    <div className="font-semibold text-sm text-foreground">
                      {club.organization_name}
                    </div>
                  </TableCell>

                  {/* Categories */}
                  <TableCell className="hidden sm:table-cell">
                    <OrganizationCategoryBadges
                      categories={club.categories}
                      maxVisible={2}
                      badgeClassName="h-5 text-[11px]"
                    />
                  </TableCell>

                  {/* Type */}
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm text-muted-foreground">
                      {club.organization_type}
                    </div>
                  </TableCell>

                  {/* Instagram */}
                  <TableCell className="hidden sm:table-cell">
                    {club.ig ? (
                      <a
                        href={`https://instagram.com/${club.ig}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-w-0 max-w-[150px] items-center gap-1 rounded-lg bg-secondary/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Instagram className="size-3.5 shrink-0" />
                        <span className="truncate">{club.ig}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>

                  {/* Discord */}
                  <TableCell className="hidden md:table-cell">
                    {club.discord && sanitizeHref(club.discord) ? (
                      <a
                        href={sanitizeHref(club.discord)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-secondary/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <MessageCircle className="size-3.5 shrink-0" />
                        <span className="truncate">{t("organizations.discord")}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </AdminTable>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            {activeTab === "followed" ? (
              <Bookmark className="size-8 text-muted-foreground" />
            ) : activeTab === "claimed" ? (
              <Users className="size-8 text-muted-foreground" />
            ) : (
              <Search className="size-8 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed"
              ? t("organizations.noFollowedClubs")
              : activeTab === "claimed"
                ? (t("organizations.noClaimedClubs") || "No claimed organizations")
                : t("organizations.noClubsFound")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {activeTab === "followed"
              ? t("organizations.emptyClubsDesc")
              : activeTab === "claimed"
                ? (t("organizations.emptyClaimedClubsDesc") || "You haven't claimed any organizations yet.")
                : t("organizations.noClubsFoundDesc")}
          </p>
        </div>
      )}

      <OrganizationDetailsModal
        organization={selectedOrganization}
        isOpen={selectedOrganization !== null}
        onClose={() => setSelectedOrganization(null)}
      />
    </div>
  );
}
