"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Bookmark, Building2, Search } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { MinimumCountFilter } from "@/shared/ui/minimum-count-filter";
import {
  ClubList,
  ClubListEmptyState,
} from "@/features/clubs/components/ClubList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useClubsPage } from "@/features/clubs/hooks/useClubsPage";
import { translateCategory } from "@/shared/utils/event";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { FilterBar } from "@/shared/layout/filter-bar";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { toast } from "@/shared/hooks/use-toast";
import { clubPagePath, ROUTES } from "@/shared/constants/routes";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { PageHeader, Stack } from "@/shared/layout";

type ClubScope = "all" | "followed" | "claimed";

interface ClubsPageProps {
  initialDirectory: PaginatedClubsResponse | null;
  initialSchool: string;
}

export function ClubsPage({
  initialDirectory,
  initialSchool,
}: ClubsPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated: authed } = useAuthState();

  const {
    searchQuery,
    minEvents,
    setMinEvents,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    selectedCategories,
    toggleCategory,
    allCategories,
    clubs,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    totalItems,
    activeTab,
    setActiveTab,
  } = useClubsPage({ initialDirectory, initialSchool });

  const savedClubIds = useSavedClubsStore(
    useShallow((state) => state.savedClubIds),
  );
  const tabOptions = [
    { value: "all" as const, label: t("clubs.allClubs") },
    { value: "followed" as const, label: t("clubs.followedClubs") },
    { value: "claimed" as const, label: t("clubs.claimedClubs") },
  ] satisfies Array<{ value: ClubScope; label: string }>;
  const activeTabOption =
    tabOptions.find((option) => option.value === activeTab) ?? tabOptions[0]!;


  const showSignInPrompt =
    (activeTab === "followed" || activeTab === "claimed") && !authed;
  const showResults =
    !showSignInPrompt && (isLoading || clubs.length > 0);
  const showEmptyState =
    !showSignInPrompt && !isLoading && clubs.length === 0;

  return (
    <Stack gap={2}>
      <PageHeader variant="listing">
        <PageCountHeading
          count={totalItems}
          label={
            totalItems === 1
              ? t("clubs.clubLabel")
              : t("clubs.clubLabel_other")
          }
        />

        <Stack direction="horizontal" align="center" gap={2}>
          <SubmittedSearchInput
            size="lg"
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={submitSearchQuery}
            onClear={clearSearchQuery}
            placeholder={t("clubs.searchPlaceholder")}
            submitLabel={t("common.search")}
            clearLabel={t("clubs.clearSearch")}
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
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
              router.push(ROUTES.CLUB_CREATE);
            }}
          >
            {t("clubs.addClub")}
          </Button>
        </Stack>

        <FilterBar refreshKey={allCategories.length} data-testid="club-category-filter-scroll" trailing={<>
            <Select
              value={activeTab}
              onValueChange={(value) =>
                setActiveTab(value as ClubScope)
              }
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
          </>}>
              <MinimumCountFilter
                value={minEvents}
                onChange={setMinEvents}
                countLabel={t("clubs.eventCount", { count: minEvents })}
                inputLabel={t("clubs.minimumEvents")}
              />
              {allCategories.map((category) => (
                <Button
                  key={category}
                  variant={
                    selectedCategories.includes(category)
                      ? "primary"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => toggleCategory(category)}
                  aria-pressed={selectedCategories.includes(category)}
                >
                  {translateCategory(category, t)}
                </Button>
              ))}
              </FilterBar>
      </PageHeader>

      {showSignInPrompt ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl bg-surface">
          <Bookmark className="size-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {activeTab === "followed"
              ? t("clubs.signInToViewClubs")
              : t("clubs.signInToViewClaimedClubs")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            {activeTab === "followed"
              ? t("clubs.signInToViewClubsDesc")
              : t("clubs.signInToViewClaimedClubsDesc")}
          </p>
          <a
            href="/login"
            className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-xl text-sm hover:opacity-90 transition-opacity"
            id={
              activeTab === "followed"
                ? "followed-clubs-sign-in"
                : "claimed-clubs-sign-in"
            }
          >
            {t("events.signIn")}
          </a>
        </div>
      ) : showResults ? (
        <ClubList
          clubs={clubs}
          savedClubIds={savedClubIds}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onClubClick={(club) =>
            router.push(clubPagePath(club.id))
          }
          onCategoryClick={toggleCategory}
        />
      ) : null}

      {showEmptyState && (
        <ClubListEmptyState
          title={
            activeTab === "followed"
              ? t("clubs.noFollowedClubs")
              : activeTab === "claimed"
                ? t("clubs.noClaimedClubs")
                : t("clubs.noClubsFound")
          }
          description={
            activeTab === "followed"
              ? t("clubs.emptyClubsDesc")
              : activeTab === "claimed"
                ? t("clubs.emptyClaimedClubsDesc")
                : t("clubs.noClubsFoundDesc")
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
    </Stack>
  );
}
