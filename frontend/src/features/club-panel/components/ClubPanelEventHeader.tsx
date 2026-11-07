import NextLink from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { QrCode, Ticket } from "lucide-react";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { ROUTES, clubPanelDoorScannerPath } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { SkeletonLine } from "@/shared/ui/skeleton";

interface ClubPanelEventHeaderProps {
  eventId: number;
  /** The event's title and when it happens; placeholder lines until the event loads. */
  heading?: { title: ReactNode; description?: ReactNode };
  /** Tickets are on, so the door scanner is offered. */
  scanner?: boolean;
}

/**
 * One event's ticket page header. The page and every loading state before it
 * draw this same header, so nothing in it moves while the page loads.
 */
export function ClubPanelEventHeader({ eventId, heading, scanner = false }: ClubPanelEventHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageHeader
      back={{ href: ROUTES.CLUB_PANEL_EVENTS, label: t("navigation.events") }}
      icon={Ticket}
      title={heading ? heading.title : <SkeletonLine className="w-72 max-w-full" />}
      description={heading ? heading.description : <SkeletonLine className="w-44" />}
      actions={
        <Stack direction="horizontal" gap={2} wrap>
          {scanner ? (
            <Button asChild>
              <NextLink href={clubPanelDoorScannerPath(eventId)}>
                <QrCode className="size-4" />
                {t("tickets.desk.openScanner")}
              </NextLink>
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <NextLink href={eventPagePath(eventId)}>{t("tickets.pass.viewEvent")}</NextLink>
          </Button>
        </Stack>
      }
    />
  );
}

/** The ticket page before its event loads: the page's own header over a panel. */
export function ClubPanelEventTicketsLoading({ eventId }: { eventId: number }) {
  return (
    <Stack gap={6} aria-busy="true">
      <ClubPanelEventHeader eventId={eventId} />
      <LoadingPage variant="panel" className="py-0" />
    </Stack>
  );
}
