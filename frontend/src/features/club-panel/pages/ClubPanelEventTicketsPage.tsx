import NextLink from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubPayouts";
import { fetchEventById } from "@/features/events/api/events.api";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import {
  TicketDeskStats,
  TicketDoorList,
  TicketSettingsCard,
  useEventTicketing,
  useTicketDesk,
  useTicketRefunds,
} from "@/features/tickets";
import { ROUTES, clubPanelDoorScannerPath } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import { PageHeader, Section, Stack } from "@/shared/layout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Skeleton } from "@/shared/ui/skeleton";
import { LoadingPage } from "@/shared/ui/loading-page";
import { formatOccurrence, getPrimaryOccurrence } from "@/shared/utils/date";
import { AlertTriangle, QrCode, Ticket } from "lucide-react";

function useEventIdParam(): number {
  const params = useParams<{ eventId?: string | string[] }>();
  const raw = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  return Number(raw) || 0;
}

/** One event's tickets: turn them on, watch them go, run the door list, refund. */
export function ClubPanelEventTicketsPage() {
  const { t, i18n } = useTranslation();
  const eventId = useEventIdParam();
  const { getSchoolTimezone } = useSchoolDirectory();
  const event = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: eventId > 0,
  });
  const ticketing = useEventTicketing(eventId);
  const desk = useTicketDesk(eventId, Boolean(ticketing.data));
  const payouts = useClubPayouts(event.data?.club_id);
  const { refundRemaining } = useTicketRefunds(eventId);

  // Payouts load once the event names its club; until then paid tickets can't be offered.
  const loading =
    event.isPending ||
    ticketing.isPending ||
    (event.data?.club_id != null && payouts.isPending) ||
    (ticketing.data != null && desk.isPending);
  if (eventId > 0 && loading) {
    return (
      <Stack gap={6} aria-busy="true">
        <PageHeader
          back={{ href: ROUTES.CLUB_PANEL_EVENTS, label: t("navigation.events") }}
          icon={Ticket}
          title={<Skeleton className="h-7 w-72" />}
          description={<Skeleton className="mt-1 h-4 w-44" />}
        />
        <LoadingPage variant="panel" className="py-0" />
      </Stack>
    );
  }
  if (!event.data) {
    return <EmptyState icon={<Ticket />} title={t("tickets.desk.notFound")} />;
  }

  const occurrence = getPrimaryOccurrence(event.data);
  const deskData = desk.data;
  const issuedEver = (deskData?.issued ?? 0) + (deskData?.refunded ?? 0);
  const paidStillValid = deskData?.ticketing.currency ? deskData.issued : 0;

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ href: ROUTES.CLUB_PANEL_EVENTS, label: t("navigation.events") }}
        icon={Ticket}
        title={event.data.title}
        description={
          occurrence
            ? formatOccurrence(occurrence, getSchoolTimezone(event.data.school), i18n.language)
            : undefined
        }
        actions={
          <Stack direction="horizontal" gap={2} wrap>
            {ticketing.data ? (
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

      {event.data.cancelled && paidStillValid > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("tickets.desk.cancelledTitle")}</AlertTitle>
          <AlertDescription>
            <Stack gap={2} align="start">
              <p>{t("tickets.desk.cancelledDescription")}</p>
              <LoadingButton
                type="button"
                variant="outline"
                size="sm"
                isLoading={refundRemaining.isPending}
                onClick={() =>
                  refundRemaining.mutate(undefined, {
                    onSuccess: ({ refunded }) =>
                      toast({ description: t("tickets.desk.refundedCount", { count: refunded }) }),
                  })
                }
              >
                {t("tickets.desk.refundRemaining")}
              </LoadingButton>
            </Stack>
          </AlertDescription>
        </Alert>
      ) : null}

      {deskData ? <TicketDeskStats desk={deskData} /> : null}

      {event.data.cancelled ? null : (
        <TicketSettingsCard
          // A fresh form whenever the saved settings change underneath it.
          key={
            ticketing.data
              ? `${ticketing.data.price_cents}:${ticketing.data.capacity}:${ticketing.data.paused}`
              : "off"
          }
          eventId={eventId}
          ticketing={ticketing.data ?? null}
          issuedEver={issuedEver}
          payouts={{
            available: Boolean(payouts.data?.paid_tickets_enabled),
            ready: Boolean(payouts.data?.charges_enabled),
            currency: payouts.data?.currency ?? "cad",
          }}
        />
      )}

      {deskData ? (
        <Section title={t("tickets.desk.attendees")}>
          <TicketDoorList
            eventId={eventId}
            school={event.data.school}
            currency={deskData.ticketing.currency}
            attendees={deskData.attendees}
            dates={deskData.dates}
          />
        </Section>
      ) : null}
    </Stack>
  );
}
