import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  Bookmark,
  Building2,
  Plus,
  Search,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
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
import { useOrganizationsPage } from "@/features/organizations/hooks/useOrganizationsPage";
import { translateCategory } from "@/shared/utils/event";
import { useAuthState } from "@/features/auth";
import { useHorizontalScrollFade } from "@/shared/hooks";
import { HorizontalScrollFade } from "@/shared/ui/horizontal-scroll-fade";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { toast } from "@/shared/hooks/use-toast";
import {
  organizationPagePath,
  ROUTES,
} from "@/shared/constants/routes";
import type { PaginatedOrganizationsResponse } from "@/features/organizations/api/organizations.api";

type OrganizationScope = "all" | "followed" | "claimed";

interface OrganizationsPageProps {
  initialDirectory: PaginatedOrganizationsResponse | null;
  initialSchool: string;
}

export function OrganizationsPage({
  initialDirectory,
  initialSchool,
}: OrganizationsPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
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
    activeTab,
    setActiveTab,
  } = useOrganizationsPage({ initialDirectory, initialSchool });

  const savedOrganizationIds = useSavedOrganizationsStore(useShallow((state) => state.savedOrganizationIds));
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
    dragScrollProps: categoryDragScrollProps,
  } = useHorizontalScrollFade<HTMLDivElement>({
    refreshKey: allCategories.length,
  });

  const showSignInPrompt = (activeTab === "followed" || activeTab === "claimed") && !authed;
  const showResults = !showSignInPrompt && (isLoading || organizations.length > 0);
  const showEmptyState = !showSignInPrompt && !isLoading && organizations.length === 0;

  return (
    <div className="space-y-2">
      <div className="space-y-3 pb-2">
        <div className="flex items-center justify-between gap-3">
          <PageCountHeading
            count={totalItems}
            label={
              totalItems === 1
                ? t("organizations.organizationLabel")
                : t("organizations.organizationLabel_other")
            }
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onMouseDown={() => {
              if (!authed) {
                toast({
                  description: t("navigation.loginRequiredToSubmit"),
                  action: {
                    label: t("events.signIn"),
                    onClick: () => router.push(ROUTES.LOGIN),
                  },
                });
                return;
              }
              router.push(ROUTES.ORGANIZATION_CREATE);
            }}
          >
            <Plus />
            {t("organizations.addClub")}
          </Button>
        </div>

        <SubmittedSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          onSubmit={submitSearchQuery}
          onClear={clearSearchQuery}
          placeholder={t("organizations.searchPlaceholder")}
          submitLabel={t("common.search")}
          clearLabel={t("organizations.clearSearch")}
        />

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <HorizontalScrollFade
              ref={categoryScrollRef}
              visible={showCategoryScrollFade}
              {...categoryDragScrollProps}
              data-testid="organization-category-filter-scroll"
              onScroll={syncCategoryScrollFade}
              onWheel={syncCategoryScrollFadeAfterWheel}
              onTouchEnd={syncCategoryScrollFade}
              className="no-visible-scrollbar flex min-w-0 cursor-grab flex-nowrap items-center gap-2 overflow-x-auto pb-1 active:cursor-grabbing"
            >
              {allCategories.map((category) => (
                <Button
                  key={category}
                  variant={selectedCategories.includes(category) ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => toggleCategory(category)}
                  aria-pressed={selectedCategories.includes(category)}
                >
                  {translateCategory(category, t)}
                </Button>
              ))}
              <span
                ref={categoryScrollEndRef}
                aria-hidden="true"
                className="h-px w-px shrink-0"
              />
            </HorizontalScrollFade>
          </div>

          <div className="relative flex shrink-0 items-center gap-2 pb-1">
            <Select
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as OrganizationScope)}
            >
              <SelectTrigger size="sm" aria-label={activeTabOption.label}>
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
        </div>
      </div>

      {showSignInPrompt ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl bg-surface">
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
          onOrganizationClick={(organization) =>
            router.push(organizationPagePath(organization.id))
          }
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

    </div>
  );
}
