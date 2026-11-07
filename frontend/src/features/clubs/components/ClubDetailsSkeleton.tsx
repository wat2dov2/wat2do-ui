"use client";

import { useTranslation } from "react-i18next";

import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { ROUTES } from "@/shared/constants/routes";
import { Separator } from "@/shared/ui/separator";
import { Skeleton } from "@/shared/ui/skeleton";
import { TabsListSkeleton } from "@/shared/ui/tabs";

/** A club's page before the club loads: logo and name, its links, then its events. */
export function ClubDetailsSkeleton() {
  const { t } = useTranslation();

  return (
    <Container size="lg">
      <Stack gap={6} aria-busy="true">
        <PageHeader
          back={{ href: ROUTES.CLUBS, label: t("clubs.allClubs") }}
          title={
            <span className="flex items-center gap-3" aria-hidden="true">
              <Skeleton className="size-12 rounded-full" />
              <Skeleton className="h-8 w-64" />
            </span>
          }
          description={<Skeleton className="mt-1 h-4 w-40" aria-hidden="true" />}
          actionsPlacement="heading"
          actions={
            <Stack direction="horizontal" gap={2} aria-hidden="true">
              <Skeleton className="h-9 w-24 rounded-xl" />
              <Skeleton className="h-9 w-28 rounded-xl" />
            </Stack>
          }
        />
        <Stack gap={3} aria-hidden="true">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Stack direction="horizontal" gap={4}>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-28" />
          </Stack>
        </Stack>
        <Separator />
        <Stack gap={6}>
          <TabsListSkeleton count={2} />
          <div className={CARD_GRID_CLASS} aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => <EventCardSkeleton key={index} />)}
          </div>
        </Stack>
      </Stack>
    </Container>
  );
}
