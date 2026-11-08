import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useClubPanelEvent, useEventIdParam } from "@/features/club-panel/hooks/useClubPanelEvent";
import { TicketSettingsForm } from "@/features/tickets";
import { clubPanelEventTicketsPath } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { PageHeader, Stack } from "@/shared/layout";
import { LoadingPage } from "@/shared/ui/loading-page";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { Ticket } from "lucide-react";

/** The form that sets up one event's tickets, or changes them. */
export function ClubPanelTicketSettingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const eventId = useEventIdParam();
  const deskHref = clubPanelEventTicketsPath(eventId);
  const { event, ticketing, desk, ticketsLoading, issuedEver, payouts } = useClubPanelEvent(eventId);
  const loading = (eventId > 0 && event.isPending) || ticketsLoading;

  const header = (
    <PageHeader
      back={{ href: deskHref, label: t("tickets.desk.title") }}
      icon={Ticket}
      title={
        loading ? (
          <SkeletonLine className="w-56 max-w-full" />
        ) : ticketing ? (
          t("tickets.settings.editTitle")
        ) : (
          t("tickets.settings.setupTitle")
        )
      }
      description={event.data?.title ?? <SkeletonLine className="w-44" />}
    />
  );

  if (loading) {
    return (
      <Stack gap={6} aria-busy="true">
        {header}
        <LoadingPage variant="panel" className="py-0" />
      </Stack>
    );
  }
  if (!event.data || event.data.cancelled) {
    return (
      <Stack gap={6}>
        {header}
        <EmptyState
          icon={<Ticket />}
          title={event.data ? t("tickets.desk.cancelledTitle") : t("tickets.desk.notFound")}
        />
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      {header}
      <TicketSettingsForm
        eventId={eventId}
        ticketing={ticketing}
        lockedTierIds={
          new Set(desk?.tiers.filter((tier) => tier.issued > 0).map((tier) => tier.tier_id))
        }
        issuedEver={issuedEver}
        payouts={payouts}
        onDone={() => router.push(deskHref)}
        cancelHref={deskHref}
      />
    </Stack>
  );
}
