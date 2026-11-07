import { useTranslation } from "react-i18next";
import type { useClubsPage } from "@/features/clubs/hooks/useClubsPage";
import { PageHeader } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { Button } from "@/shared/ui/button";
import { IntegerFilter } from "@/shared/ui/integer-filter";
import { NewlyAddedFilterButton } from "@/shared/ui/newly-added-filter-button";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { translateCategory } from "@/shared/utils/event";

type ClubScope = "all" | "followed" | "claimed";

/** The directory controls the header shows; the route's loading state passes their initial values. */
export type ClubsHeaderState = Pick<
  ReturnType<typeof useClubsPage>,
  | "appliedQueryKey" | "addedSince" | "setAddedSince" | "clearNew"
  | "searchQuery" | "setSearchQuery" | "submitSearchQuery" | "clearSearchQuery"
  | "minEvents" | "setMinEvents" | "selectedCategories" | "toggleCategory"
  | "allCategories" | "activeTab" | "setActiveTab"
>;

interface ClubsPageHeaderProps {
  state: ClubsHeaderState;
  /** Null while the directory loads. */
  count: number | null;
  disabled: boolean;
}

/**
 * The clubs page's heading, search and filter row. The route's loading state
 * renders this same header, so nothing above the directory moves when it arrives.
 */
export function ClubsPageHeader({ state, count, disabled }: ClubsPageHeaderProps) {
  const { t } = useTranslation();
  const tabOptions = [
    { value: "all" as const, label: t("clubs.allClubs") },
    { value: "followed" as const, label: t("clubs.followedClubs") },
    { value: "claimed" as const, label: t("clubs.claimedClubs") },
  ] satisfies Array<{ value: ClubScope; label: string }>;
  const activeTabOption =
    tabOptions.find((option) => option.value === state.activeTab) ?? tabOptions[0]!;

  return (
    <PageHeader variant="listing">
      <PageCountHeading
        count={count}
        label={count === 1 ? t("clubs.clubLabel") : t("clubs.clubLabel_other")}
      />

      <SubmittedSearchInput
        size="lg"
        value={state.searchQuery}
        onChange={state.setSearchQuery}
        onSubmit={state.submitSearchQuery}
        onClear={state.clearSearchQuery}
        placeholder={t("clubs.searchPlaceholder")}
        submitLabel={t("common.search")}
        clearLabel={t("clubs.clearSearch")}
      />

      <FilterBar appliedQueryKey={state.appliedQueryKey} disabled={disabled} refreshKey={state.allCategories.length} data-testid="club-category-filter-scroll" trailing={
        <Select
          value={state.activeTab}
          onValueChange={(value) => state.setActiveTab(value as ClubScope)}
        >
          <SelectTrigger size="sm" aria-label={activeTabOption.label}>
            {/* The label renders with the page; an empty value would fill in only after hydration. */}
            <SelectValue>{activeTabOption.label}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {tabOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }>
        <NewlyAddedFilterButton
          value={state.addedSince}
          onValueChange={state.setAddedSince}
          onClear={state.clearNew}
        />
        <IntegerFilter
          value={state.minEvents}
          active={state.minEvents > 0}
          onChange={(value) => state.setMinEvents(Number(value))}
          label={`>${t("clubs.eventCount", { count: state.minEvents })}`}
          inputLabel={t("clubs.minimumEvents")}
        />
        {state.allCategories.map((category) => (
          <Button
            activation="click"
            key={category}
            variant={state.selectedCategories.includes(category) ? "primary" : "outline"}
            size="sm"
            onClick={() => state.toggleCategory(category)}
            aria-pressed={state.selectedCategories.includes(category)}
          >
            {translateCategory(category, t)}
          </Button>
        ))}
      </FilterBar>
    </PageHeader>
  );
}
