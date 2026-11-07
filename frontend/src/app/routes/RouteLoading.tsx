"use client";

import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { AboutPage } from "@/features/contact/pages/AboutPage";
import { AuthEntryPage } from "@/features/auth/pages/AuthEntryPage";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { LandingPage } from "@/features/landing/pages/LandingPage";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import { ClubDetailsSkeleton } from "@/features/clubs/components/ClubDetailsSkeleton";
import { EventDetailsBodySkeleton } from "@/features/events/components/EventDetailsDrawerSkeleton";
import { POSITION_TYPES } from "@/features/positions/api/positions.api";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { getEventQuickFilters, getEventFilterCategories } from "@/shared/constants/eventFilters";
import { ROUTES } from "@/shared/constants/routes";
import { LoadingPage, PageShellLoading } from "@/shared/ui/loading-page";
import { PAGE_SHELLS } from "@/shared/constants/pageShells";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { Button } from "@/shared/ui/button";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { translateCategory } from "@/shared/utils/event";

const ignoreInput = () => {};

/** Route fallbacks show known controls without starting another feed request. */
function DiscoveryLoading({ resource }: { resource: "events" | "clubs" | "positions" }) {
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

/** Shared by native route streaming, lazy route chunks, and auth gates. */
export function RouteLoading() {
  const pathname = usePathname();
  const { t } = useTranslation();
  if (pathname === ROUTES.LANDING_PREVIEW) return <LandingPage snapshot={null} />;
  if (pathname === ROUTES.ABOUT) return <AboutPage isLoading />;
  if (pathname === ROUTES.LOGIN) return <AuthEntryPage isPending preview={<AuthHeroPanel isLoading />} />;
  if (pathname === ROUTES.EVENTS) return <DiscoveryLoading resource="events" />;
  if (pathname === ROUTES.CLUBS) return <DiscoveryLoading resource="clubs" />;
  if (pathname === ROUTES.POSITIONS) return <DiscoveryLoading resource="positions" />;
  if (/^\/clubs\/\d+\/?$/.test(pathname)) return <ClubDetailsSkeleton />;
  if (/^\/events\/\d+\/?$/.test(pathname)) {
    return <Container size="lg"><Stack gap={6}>
      <PageHeader back={{ href: ROUTES.EVENTS, label: t("events.allEvents") }} />
      <EventDetailsBodySkeleton />
    </Stack></Container>;
  }
  if (pathname in PAGE_SHELLS) return <PageShellLoading route={pathname} />;
  return <LoadingPage />;
}
