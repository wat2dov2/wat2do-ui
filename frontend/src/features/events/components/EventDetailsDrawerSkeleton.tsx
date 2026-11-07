import { useTranslation } from "react-i18next";
import { ClubBadgeSkeleton } from "@/features/clubs/components/ClubBadgeLink";
import {
  EVENT_DETAILS_LAYOUT,
  EventActionsPlaceholder,
  EventRegistrationPrompt,
} from "@/features/events/components/EventDetailsSections";
import { DrawerBody, FormGrid, Section, Stack } from "@/shared/layout";
import { Card } from "@/shared/ui/card";
import { DrawerHeader } from "@/shared/ui/drawer";
import { Separator } from "@/shared/ui/separator";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

const ignore = () => {};

export function EventDetailsDrawerSkeleton() {
  return (
    <>
      <DrawerHeader className="text-left" navigation={{}}>
        <Stack direction="horizontal" justify="end" align="center" gap={3} wrap>
          <EventActionsPlaceholder />
        </Stack>
      </DrawerHeader>

      <Separator />

      <DrawerBody aria-hidden="true">
        <EventDetailsBodySkeleton />
      </DrawerBody>
    </>
  );
}

/** A fact row: its tile, and the one or two lines of text beside it. */
function FactSkeleton({ lines }: { lines: 1 | 2 }) {
  return (
    <Stack direction="horizontal" gap={3} align="center">
      <Card className="size-10 shrink-0 py-0" />
      <div className="min-w-0 flex-1 text-sm">
        <SkeletonLine className="w-4/5" />
        {lines === 2 ? <SkeletonLine className="w-1/2" /> : null}
      </div>
    </Stack>
  );
}

/**
 * The event details layout before the event loads, box for box: poster, a
 * title of usual length, the date, place, food and price facts, the Going
 * card, the description and the host. Section headings and the Going card
 * are the real ones, since they do not depend on the event.
 */
export function EventDetailsBodySkeleton() {
  const { t } = useTranslation();
  return (
    <div data-slot="event-details-loading" aria-busy="true" className={EVENT_DETAILS_LAYOUT.grid}>
      <div className={EVENT_DETAILS_LAYOUT.poster}>
        <Skeleton data-skeleton-key="event-poster" className="aspect-square w-full rounded-xl" />
      </div>

      <div className={EVENT_DETAILS_LAYOUT.details}>
        <Stack gap={2} className="order-1" data-skeleton-key="event-title">
          {/* Titles usually take two lines on a phone and one beside the poster. */}
          <div className={EVENT_DETAILS_LAYOUT.title}>
            <SkeletonLine className="w-4/5" />
            <div className="md:hidden"><SkeletonLine className="w-1/2" /></div>
          </div>
          <div className="text-sm"><SkeletonLine className="w-64 max-w-full" /></div>
        </Stack>

        <Stack gap={6} className="order-3" data-skeleton-key="event-facts">
          <FormGrid columns={2} collapse={false}>
            <FactSkeleton lines={2} />
            <FactSkeleton lines={1} />
            <FactSkeleton lines={1} />
            <FactSkeleton lines={1} />
          </FormGrid>
          <div inert>
            <EventRegistrationPrompt school={null} unavailable isPending={false} onRegister={ignore} />
          </div>
        </Stack>

        <Stack gap={6} className="order-4" data-skeleton-key="event-about">
          <Section variant="divided" title={t("events.aboutEvent")}>
            <div className="text-sm">
              <SkeletonLine />
              <SkeletonLine className="w-11/12" />
            </div>
          </Section>
        </Stack>
      </div>

      <Stack gap={6} className={EVENT_DETAILS_LAYOUT.sidebar} data-skeleton-key="event-host">
        <Section variant="divided" title={t("events.hostedBy")}>
          <ClubBadgeSkeleton />
        </Section>
      </Stack>
    </div>
  );
}
