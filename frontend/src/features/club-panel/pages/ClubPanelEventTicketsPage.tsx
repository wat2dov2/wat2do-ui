import NextLink from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubTicketing";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { fetchEventById } from "@/features/events/api/events.api";
import {
  TicketDoorList,
  TicketSalesStats,
  TicketSettingsCard,
  useEventTicketing,
  useTicketRefunds,
  useTicketSales,
} from "@/features/tickets";
import { ROUTES, clubPanelDoorScannerPath } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { queryKeys } from "@/shared/lib/queryKeys";
import { PageHeader, Section, Stack } from "@/shared/layout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { AlertTriangle, QrCode, Ticket } from "lucide-react";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatOccurrence, getPrimaryOccurrence } from "@/shared/utils/date";
import { toast } from "@/shared/hooks/use-toast";

function useEventIdParam(): number {
  const params = useParams<{ eventId?: string | string[] }>();
  const raw = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  return Number(raw) || 0;
}

/** One event's ticket desk: start selling, watch sales, run the door list, refund. */
export function ClubPanelEventTicketsPage() {
  const { t, i18n } = useTranslation();
  const eventId = useEventIdParam();
  const { getSchoolTimezone } = useSchoolDirectory();
  const event = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: eventId > 0,
  });
  const ticketing = useEventTicketing(eventId > 0 ? eventId : null);
  const sales = useTicketSales(eventId, Boolean(ticketing.data));
  const payouts = useClubPayouts(event.data?.club_id);
  const { refundRemaining } = useTicketRefunds(eventId);

  // Payouts load after the event names its club; until then the card can't tell if Stripe is ready.
  const loading =
    event.isPending || ticketing.isPending || (event.data?.club_id != null && payouts.isPending);
  if (eventId > 0 && loading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  if (!event.data) {
    return <EmptyState icon={<Ticket />} title={t("tickets.desk.notFound")} />;
  }

  const timeZone = getSchoolTimezone(event.data.school);
  const occurrence = getPrimaryOccurrence(event.data);
  const stillValid = sales.data?.sold ?? 0;
  const soldEver = (sales.data?.sold ?? 0) + (sales.data?.refunded ?? 0);

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ href: ROUTES.CLUB_PANEL_EVENTS, label: t("clubPanel.events") }}
        icon={Ticket}
        title={event.data.title}
        description={occurrence ? formatOccurrence(occurrence, timeZone, i18n.language) : undefined}
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

      {event.data.cancelled && stillValid > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("tickets.desk.cancelledTitle")}</AlertTitle>
          <AlertDescription>
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
          </AlertDescription>
        </Alert>
      ) : null}

      {sales.data ? <TicketSalesStats sales={sales.data} /> : null}

      {event.data.cancelled ? null : (
        <TicketSettingsCard
          key={ticketing.data ? `selling-${ticketing.data.price_cents}` : "not-selling"}
          eventId={eventId}
          ticketing={ticketing.data ?? null}
          currency={ticketing.data?.currency ?? payouts.data?.currency ?? "cad"}
          sold={soldEver}
          payoutsReady={Boolean(payouts.data?.charges_enabled)}
        />
      )}

      {sales.data ? (
        <Section title={t("tickets.desk.attendees")}>
          <TicketDoorList
            eventId={eventId}
            school={event.data.school}
            currency={sales.data.currency}
            attendees={sales.data.attendees}
            dates={sales.data.dates}
          />
        </Section>
      ) : null}
    </Stack>
  );
}
