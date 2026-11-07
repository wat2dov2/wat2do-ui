"use client";

import { useTranslation } from "react-i18next";
import { BadgeCheck, Check, Plus } from "lucide-react";
import { useRequestSchool } from "@/app/client-providers";
import { ClubCategoryBadges } from "@/features/clubs/components/ClubCategoryBadges";
import { ClubEventsGridSkeleton } from "@/features/events/components/ClubEventsGrid";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { ROUTES } from "@/shared/constants/routes";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";
import { IconSwap } from "@/shared/ui/icon-swap";
import { Separator } from "@/shared/ui/separator";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

/**
 * A club's page before the club loads, laid out like the page: logo and name
 * over the school, the follow and claim buttons, a category and two links,
 * then the activity tabs and the events grid. Everything that does not depend
 * on the club (school name, buttons, tabs) is the real control.
 */
export function ClubDetailsSkeleton() {
  const { t } = useTranslation();
  const school = useRequestSchool();
  const { getSchoolName } = useSchoolDirectory();
  const { club_categories: categories } = useAppConstants();

  return (
    <Container size="lg" data-slot="club-details-loading">
      <Stack gap={6} aria-busy="true">
        <PageHeader
          back={{ href: ROUTES.CLUBS, label: t("clubs.allClubs") }}
          title={
            <span className="flex items-center gap-3" aria-hidden="true">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <span className="w-64 max-w-full"><SkeletonLine /></span>
            </span>
          }
          description={getSchoolName(school)}
          actionsPlacement="heading"
          actions={
            <Stack direction="horizontal" gap={2} align="center" wrap justify="end" aria-hidden="true">
              <Button type="button" variant="outline" disabled tabIndex={-1}>
                <IconSwap showAlternate={false} icon={<Plus />} alternate={<Check />} />
                {t("clubs.follow")}
              </Button>
              <Button type="button" variant="outline" disabled tabIndex={-1}>
                <BadgeCheck />
                {t("clubs.claimClub")}
              </Button>
            </Stack>
          }
        />
        <Stack gap={3} aria-hidden="true" data-skeleton-key="club-meta">
          <Skeleton className="w-fit rounded-full">
            <div className="invisible">
              <ClubCategoryBadges categories={categories.slice(0, 1)} badgeClassName="text-xs px-2.5" />
            </div>
          </Skeleton>
          <Stack direction="horizontal" gap={4} align="center" wrap>
            <span className="flex w-48 items-center gap-2 text-sm"><SkeletonLine /></span>
            <span className="flex w-28 items-center gap-2 text-sm"><SkeletonLine /></span>
          </Stack>
        </Stack>
        <Separator />
        <Tabs defaultValue="events">
          <TabsList data-skeleton-key="club-tabs" aria-label={t("clubs.activityTabsLabel")}>
            <TabsTrigger value="events" disabled>{t("navigation.events")}</TabsTrigger>
            <TabsTrigger value="positions" disabled>{t("navigation.positions")}</TabsTrigger>
          </TabsList>
          <TabsContent value="events" className="mt-6">
            <ClubEventsGridSkeleton />
          </TabsContent>
        </Tabs>
      </Stack>
    </Container>
  );
}
