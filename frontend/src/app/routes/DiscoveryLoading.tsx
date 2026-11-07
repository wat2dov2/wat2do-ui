"use client";

import { useTranslation } from "react-i18next";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import { POSITION_TYPES } from "@/features/positions/api/positions.api";
import { PageHeader, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { getEventQuickFilters, getEventFilterCategories } from "@/shared/constants/eventFilters";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { Button } from "@/shared/ui/button";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { translateCategory } from "@/shared/utils/event";

const ignoreInput = () => {};

/** Route fallbacks show known controls without starting another feed request. */
export function DiscoveryLoading({ resource }: { resource: "events" | "clubs" | "positions" }) {
  const { t } = useTranslation();
  const constants = useAppConstants();
  const isEvents = resource === "events";
  const isClubs = resource === "clubs";
  const label = isEvents ? t("events.upcomingEventCount", { count: 2 })
    : isClubs ? t("clubs.clubLabel", { count: 2 }) : t("positions.position", { count: 2 });
  const categories = isClubs ? constants.club_categories : getEventFilterCategories(constants.event_categories);

  return (
    <Stack gap={2} data-slot="discovery-loading" aria-busy="true">
      <PageHeader variant="listing">
        <PageCountHeading count={null} label={label} latest={isClubs ? undefined : null} />
        <SubmittedSearchInput
          size="lg" value="" onChange={ignoreInput} onSubmit={ignoreInput} onClear={ignoreInput} disabled
          placeholder={isEvents ? t("search.placeholder") : t(`${resource}.searchPlaceholder`)}
          submitLabel={t("common.search")} clearLabel={t("search.clear")}
        />
        <FilterBar disabled>
          {isEvents ? getEventQuickFilters().map(config => (
            "labelKey" in config ? <Button key={config.id} variant="outline" size="sm" disabled>{config.id === "minGoing" ? `>${t(config.labelKey, { count: 0 })}` : t(config.labelKey)}</Button> : null
          )) : !isClubs ? <Button variant="outline" size="sm" disabled>{t("common.newlyAddedFilter.last24Hours")}</Button> : null}
          {resource === "positions" ? POSITION_TYPES.map(type => (
            <Button key={type} variant="outline" size="sm" disabled>{t(`positions.types.${type}`)}</Button>
          )) : categories.map(category => (
            <Button key={category} variant="outline" size="sm" disabled>{translateCategory(category, t)}</Button>
          ))}
        </FilterBar>
      </PageHeader>
      <div className={CARD_GRID_CLASS} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => isClubs
          ? <ClubCardSkeleton key={index} /> : <EventCardSkeleton key={index} />)}
      </div>
    </Stack>
  );
}
