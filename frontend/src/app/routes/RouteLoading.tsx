"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { AboutPage } from "@/features/contact/pages/AboutPage";
import { AuthEntryPage } from "@/features/auth/pages/AuthEntryPage";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import { POSITION_TYPES } from "@/features/positions/api/positions.api";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { eventQuickFilters, getEventFilterCategories } from "@/shared/constants/eventFilters";
import { ROUTES } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";
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
  const addLabel = isEvents ? t("events.submitEvent") : isClubs ? t("clubs.addClub") : t("positions.addPosition");
  const addHref = isEvents ? ROUTES.EVENT_SUBMIT : isClubs ? ROUTES.CLUB_CREATE : ROUTES.POSITION_SUBMIT;
  const categories = isClubs ? constants.club_categories : getEventFilterCategories(constants.event_categories);

  return (
    <Stack gap={2} data-slot="discovery-loading" aria-busy="true">
      <PageHeader variant="listing">
        <PageCountHeading count={null} label={label} latest={isClubs ? undefined : null} />
        <Stack direction="horizontal" gap={2} align="center">
          <SubmittedSearchInput
            size="lg" value="" onChange={ignoreInput} onSubmit={ignoreInput} onClear={ignoreInput} disabled
            placeholder={isEvents ? t("search.placeholder") : t(`${resource}.searchPlaceholder`)}
            submitLabel={t("common.search")} clearLabel={t("search.clear")}
          />
          <Button asChild variant="outline" size="lg"><Link href={addHref}>{addLabel}</Link></Button>
        </Stack>
        <FilterBar disabled>
          {isEvents ? eventQuickFilters.filter(config => !("requiresProfile" in config)).map(config => (
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
  if (pathname === ROUTES.ABOUT) return <AboutPage isLoading />;
  if (pathname === ROUTES.LOGIN) return <AuthEntryPage isPending preview={<AuthHeroPanel isLoading />} />;
  if (pathname === ROUTES.EVENTS) return <DiscoveryLoading resource="events" />;
  if (pathname === ROUTES.CLUBS) return <DiscoveryLoading resource="clubs" />;
  if (pathname === ROUTES.POSITIONS) return <DiscoveryLoading resource="positions" />;
  if (/^\/(events|clubs)\/\d+\/?$/.test(pathname)) {
    const isEvent = pathname.startsWith("/events/");
    return <Container size="lg"><Stack gap={6}>
      <PageHeader back={{ href: isEvent ? ROUTES.EVENTS : ROUTES.CLUBS, label: t(isEvent ? "events.allEvents" : "clubs.allClubs") }} />
      <LoadingPage variant="detail" />
    </Stack></Container>;
  }

  const titleKey = {
    [ROUTES.SETTINGS]: "navigation.settings",
    [ROUTES.EVENT_SUBMIT]: "events.submitEvent",
    [ROUTES.POSITION_SUBMIT]: "positions.addPosition",
    [ROUTES.CLUB_CREATE]: "clubs.addClub",
    [ROUTES.ADMIN]: "navigation.admin",
    [ROUTES.ADMIN_EVENTS]: "navigation.events",
    [ROUTES.ADMIN_CLUBS]: "navigation.clubs",
    [ROUTES.ADMIN_POSITIONS]: "navigation.positions",
    [ROUTES.ADMIN_POSTERS]: "admin.qrAssets.title",
    [ROUTES.ADMIN_INSTAGRAM]: "admin.instagramPublishing.title",
    [ROUTES.ADMIN_DIAGNOSTICS]: "admin.diagnostics.title",
    [ROUTES.CLUB_PANEL]: "clubPanel.title",
    [ROUTES.CLUB_PANEL_MEMBERS]: "clubPanel.members",
    [ROUTES.CLUB_PANEL_INTEGRATIONS]: "clubPanel.integrations",
    [ROUTES.CLUB_PANEL_POSTERS]: "admin.qrAssets.title",
    [ROUTES.POSTERS]: "posters.dashboard.title",
  }[pathname];
  const formRoutes: readonly string[] = [ROUTES.SETTINGS, ROUTES.EVENT_SUBMIT, ROUTES.POSITION_SUBMIT, ROUTES.CLUB_CREATE, ROUTES.CLUB_PANEL_INTEGRATIONS];
  const back = pathname.startsWith(`${ROUTES.ADMIN}/`)
    ? { href: ROUTES.ADMIN, label: t("admin.backToDashboard") }
    : pathname.startsWith(`${ROUTES.CLUB_PANEL}/`)
      ? { href: ROUTES.CLUB_PANEL, label: t("clubPanel.backToPanel") }
      : undefined;
  return <Stack gap={6}>
    {titleKey ? <PageHeader title={t(titleKey)} back={back} /> : null}
    <LoadingPage variant={formRoutes.includes(pathname) ? "form" : pathname.startsWith(ROUTES.ADMIN) ? "table" : "content"} />
  </Stack>;
}
