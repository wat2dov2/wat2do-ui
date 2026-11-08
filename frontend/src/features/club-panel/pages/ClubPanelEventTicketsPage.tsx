import { useTranslation } from "react-i18next";
import {
  ClubPanelEventHeader,
  ClubPanelEventTicketsLoading,
} from "@/features/club-panel/components/ClubPanelEventHeader";
import { useClubPanelEvent, useEventIdParam } from "@/features/club-panel/hooks/useClubPanelEvent";
import {
  TicketDeskStats,
  TicketDoorList,
  TicketSettingsSummary,
  useTicketRefunds,
} from "@/features/tickets";
import { clubPanelTicketSettingsPath } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { toast } from "@/shared/hooks/use-toast";
import { Section, Stack } from "@/shared/layout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { LoadingButton } from "@/shared/ui/loading-button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { formatOccurrence, getPrimaryOccurrence } from "@/shared/utils/date";
import { AlertTriangle, Ticket } from "lucide-react";

/** One event's tickets: set them up, watch them go, run the door list, refund. */
export function ClubPanelEventTicketsPage() {
  const { t, i18n } = useTranslation();
  const eventId = useEventIdParam();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { event, ticketing, desk: deskData, ticketsLoading } = useClubPanelEvent(eventId);
  const { refundRemaining } = useTicketRefunds(eventId);

  if (eventId > 0 && event.isPending) {
    return <ClubPanelEventTicketsLoading eventId={eventId} />;
  }
  if (!event.data) {
    return <EmptyState icon={<Ticket />} title={t("tickets.desk.notFound")} />;
  }

  const occurrence = getPrimaryOccurrence(event.data);
  const header = (
    <ClubPanelEventHeader
      eventId={eventId}
      heading={{
        title: event.data.title,
        description: occurrence
          ? formatOccurrence(occurrence, getSchoolTimezone(event.data.school), i18n.language)
          : undefined,
      }}
      scanner={Boolean(ticketing)}
    />
  );
  if (ticketsLoading) {
    return (
      <Stack gap={6} aria-busy="true">
        {header}
        <LoadingPage variant="panel" className="py-0" />
      </Stack>
    );
  }

  const paidStillValid = deskData?.ticketing.currency ? deskData.issued : 0;

  return (
    <Stack gap={6}>
      {header}

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
        <TicketSettingsSummary
          ticketing={ticketing}
          desk={deskData}
          settingsHref={clubPanelTicketSettingsPath(eventId)}
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
