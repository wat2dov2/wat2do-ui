import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  Bookmark,
  Building2,
  Plus,
  Search,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { AddOrganizationModal } from "@/features/organizations/components/AddOrganizationModal";
import { OrganizationDetailsModal } from "@/features/organizations/components/OrganizationDetailsModal";
import {
  OrganizationList,
  OrganizationListEmptyState,
} from "@/features/organizations/components/OrganizationList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { QuickFilterChip } from "@/features/search";
import { useOrganizationsPage } from "@/features/organizations/hooks/useOrganizationsPage";
import { translateCategory } from "@/shared/utils/event";
import { useAuthState } from "@/features/auth";
import { fetchProfileAPI } from "@/features/auth/api/auth.api";
import { useHorizontalScrollFade } from "@/shared/hooks";
import { HorizontalScrollFadeEdge } from "@/shared/ui/horizontal-scroll-fade-edge";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import type { Organization } from "@/shared/types";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { createOrganizationAPI } from "@/features/organizations/api/organizations.api";
import { toast } from "@/shared/hooks/use-toast";

type OrganizationScope = "all" | "followed" | "claimed";

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
    isLoadingMore,
    hasMore,
    loadMore,
    totalItems,
    refreshOrganizations,
    activeTab,
    setActiveTab,
  } = useOrganizationsPage();

  const savedOrganizationIds = useSavedOrganizationsStore(useShallow((state) => state.savedOrganizationIds));
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [showAddOrganization, setShowAddOrganization] = useState(false);
  const tabOptions = [
    { value: "all" as const, label: t("organizations.allClubs") },
    { value: "followed" as const, label: t("organizations.followedClubs") },
    { value: "claimed" as const, label: t("organizations.claimedClubs") },
  ] satisfies Array<{ value: OrganizationScope; label: string }>;
  const activeTabOption = tabOptions.find((option) => option.value === activeTab) ?? tabOptions[0]!;

  const {
    scrollRef: categoryScrollRef,
    scrollEndRef: categoryScrollEndRef,
    showScrollFade: showCategoryScrollFade,
    syncScrollFade: syncCategoryScrollFade,
    syncScrollFadeAfterWheel: syncCategoryScrollFadeAfterWheel,
  } = useHorizontalScrollFade<HTMLDivElement>({
    refreshKey: allCategories.length,
  });

  const showSignInPrompt = (activeTab === "followed" || activeTab === "claimed") && !authed;
  const showResults = !showSignInPrompt && (isLoading || organizations.length > 0);
  const showEmptyState = !showSignInPrompt && !isLoading && organizations.length === 0;

  const handleCreateOrganization = async (organization: Organization) => {
    await createOrganizationAPI({
      organization_name: organization.organization_name,
      categories: organization.categories,
      organization_page: organization.organization_page,
      ig: organization.ig,
      discord: organization.discord,
      organization_type: organization.organization_type,
      logo_url: organization.logo_url,
      school: organization.school,
    });
    await fetchProfileAPI();
    refreshOrganizations();
  };

  return (
    <div className="space-y-2">
      <div className="space-y-3 pb-2">
        <PageCountHeading
          count={totalItems}
          label={
            totalItems === 1
              ? t("organizations.organizationLabel")
              : t("organizations.organizationLabel_other")
          }
        />

        <div className="flex items-stretch gap-3">
          <SubmittedSearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={submitSearchQuery}
            onClear={clearSearchQuery}
            placeholder={t("organizations.searchPlaceholder")}
            submitLabel={t("common.search")}
            clearLabel={t("organizations.clearSearch")}
          />

          <div className="flex shrink-0 self-stretch">
            <Select
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as OrganizationScope)}
            >
              <SelectTrigger
                showIcon={false}
                className="h-full data-[size=default]:h-full"
                aria-label={activeTabOption.label}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {tabOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="secondary"
            className="h-auto self-stretch px-3"
            onMouseDown={() => {
              if (!authed) {
                toast({ description: t("navigation.loginRequiredToSubmit") });
                return;
              }
              setShowAddOrganization(true);
            }}
            aria-label={t("organizations.addClub")}
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("organizations.addClub")}</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <div
              ref={categoryScrollRef}
              onScroll={syncCategoryScrollFade}
              onWheel={syncCategoryScrollFadeAfterWheel}
              onTouchEnd={syncCategoryScrollFade}
              className="no-visible-scrollbar flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1"
            >
              {allCategories.map((category) => (
                <QuickFilterChip
                  key={category}
                  icon={null}
                  label={translateCategory(category, t)}
                  active={selectedCategories.includes(category)}
                  onClick={() => toggleCategory(category)}
                />
              ))}
              <span
                ref={categoryScrollEndRef}
                aria-hidden="true"
                className="h-px w-px shrink-0"
              />
            </div>
            <HorizontalScrollFadeEdge visible={showCategoryScrollFade} />
          </div>
        </div>
      </div>

      {showSignInPrompt ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl bg-card">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed"
              ? t("organizations.signInToViewClubs")
              : t("organizations.signInToViewClaimedClubs")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            {activeTab === "followed"
              ? t("organizations.signInToViewClubsDesc")
              : t("organizations.signInToViewClaimedClubsDesc")}
          </p>
          <a
            href="/login"
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-xl text-sm hover:opacity-90 transition-opacity"
            id={activeTab === "followed" ? "followed-clubs-sign-in" : "claimed-clubs-sign-in"}
          >
            {t("events.signIn")}
          </a>
        </div>
      ) : showResults ? (
        <OrganizationList
          organizations={organizations}
          savedOrganizationIds={savedOrganizationIds}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onOrganizationClick={setSelectedOrganization}
          onCategoryClick={toggleCategory}
        />
      ) : null}

      {showEmptyState && (
        <OrganizationListEmptyState
          title={
            activeTab === "followed"
              ? t("organizations.noFollowedClubs")
              : activeTab === "claimed"
                ? t("organizations.noClaimedClubs")
                : t("organizations.noClubsFound")
          }
          description={
            activeTab === "followed"
              ? t("organizations.emptyClubsDesc")
              : activeTab === "claimed"
                ? t("organizations.emptyClaimedClubsDesc")
                : t("organizations.noClubsFoundDesc")
          }
          icon={
            activeTab === "followed" ? (
              <Bookmark className="size-8 text-muted-foreground" />
            ) : activeTab === "claimed" ? (
              <Building2 className="size-8 text-muted-foreground" />
            ) : (
              <Search className="size-8 text-muted-foreground" />
            )
          }
        />
      )}

      <OrganizationDetailsModal
        organization={selectedOrganization}
        isOpen={selectedOrganization !== null}
        onClose={() => setSelectedOrganization(null)}
      />

      <AddOrganizationModal
        isOpen={showAddOrganization && authed}
        onClose={() => setShowAddOrganization(false)}
        onSave={handleCreateOrganization}
      />
    </div>
  );
}
