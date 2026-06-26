import { useState } from "react";
import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";
import {
  Bookmark,
  Search,
  Building2,
  Instagram,
  MessageCircle,
  OrganizationChart,
} from "@/shared/ui/doodle-icons";
import { OrganizationDetailsModal } from "@/features/organizations/components/OrganizationDetailsModal";
import { LoadingPage } from "@/shared/ui/loading-page";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { QuickFilterChip } from "@/features/search";
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
  const shouldShowOrganizationMeta = !((activeTab === "followed" || activeTab === "claimed") && !authed);
  const tabOptions = [
    { value: "all" as const, label: t("organizations.allClubs"), icon: Building2 },
    { value: "followed" as const, label: t("organizations.followedClubs"), icon: Bookmark },
    { value: "claimed" as const, label: t("organizations.claimedClubs"), icon: OrganizationChart },
  ];
  const activeTabOption = tabOptions.find((option) => option.value === activeTab) ?? tabOptions[0]!;
  const ActiveTabIcon = activeTabOption.icon;

  return (
    <div className="space-y-2">
      <div className="space-y-3 pb-2">
        <div className="flex items-stretch gap-3">
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

          {/* Organization scope dropdown */}
          <div className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-elevation="control"
                  className="flex size-11 items-center justify-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={activeTabOption.label}
                  title={activeTabOption.label}
                >
                  <ActiveTabIcon className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {tabOptions.map((option) => {
                  const TabIcon = option.icon;

                  return (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => setActiveTab(option.value)}
                    >
                      <TabIcon className="size-3.5" />
                      {option.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {shouldShowOrganizationMeta && (
            <div className="shrink-0 pb-1">
              <span className="inline-flex items-baseline gap-1 text-base font-bold text-foreground">
                <NumberFlow value={totalItems} respectMotionPreference={false} />
                <span>{totalItems === 1 ? t("organizations.organizationLabel") : t("organizations.organizationLabel_other")}</span>
              </span>
            </div>
          )}

          {/* Category Chips */}
          <div className="no-visible-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            {allCategories.map((category) => (
              <QuickFilterChip
                key={category}
                icon={null}
                label={translateCategory(category, t)}
                active={selectedCategories.includes(category)}
                onMouseDown={() => toggleCategory(category)}
              />
            ))}
          </div>
        </div>

        {/* Pagination */}
        {shouldShowOrganizationMeta && totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            itemLabel={t("admin.club")}
            itemLabelPlural={t("navigation.organizations")}
            onPageChange={setCurrentPage}
            hideDetails
            hideNavigationLabels
          />
        )}
      </div>

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
              { label: t("forms.categories") },
              { label: t("forms.organizationType") },
              { label: <span className="flex items-center gap-1.5"><Instagram className="size-3.5" />{t("admin.instagram")}</span> },
              { label: <span className="flex items-center gap-1.5"><MessageCircle className="size-3.5" />{t("admin.discord")}</span> },
            ]}
          >
            {organizations.map((club) => {
              return (
                <TableRow
                  key={club.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedOrganization(club)}
                >
                  {/* Name */}
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {club.organization_name}
                    </div>
                  </TableCell>

                  {/* Categories */}
                  <TableCell>
                    <OrganizationCategoryBadges
                      categories={club.categories}
                      maxVisible={2}
                      badgeClassName="h-5 text-[11px]"
                    />
                  </TableCell>

                  {/* Type */}
                  <TableCell>
                    <div className="text-sm text-muted-foreground">
                      {club.organization_type}
                    </div>
                  </TableCell>

                  {/* Instagram */}
                  <TableCell>
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
                  <TableCell>
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
              <Building2 className="size-8 text-muted-foreground" />
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
