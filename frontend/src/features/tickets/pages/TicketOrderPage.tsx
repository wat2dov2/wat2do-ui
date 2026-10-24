"use client";

import NextLink from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { TicketPass } from "@/features/tickets/components/TicketPass";
import { useTicketOrder } from "@/features/tickets/hooks/useTickets";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { CheckCircle2, Ticket } from "lucide-react";
import { Spinner } from "@/shared/ui/spinner";

/** Where Stripe returns a buyer: confirms the payment, then shows the tickets. */
export function TicketOrderPage() {
  const { t } = useTranslation();
  const params = useParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId ?? "";
  const { data: order, isError } = useTicketOrder(orderId);

  if (isError) {
    return (
      <Container size="sm">
        <EmptyState
          icon={<Ticket />}
          title={t("tickets.order.notFound")}
          action={
            <Button asChild>
              <NextLink href={ROUTES.TICKETS}>{t("tickets.order.allTickets")}</NextLink>
            </Button>
          }
        />
      </Container>
    );
  }

  if (!order || order.status === "pending") {
    return (
      <Container size="sm">
        <EmptyState
          icon={<Spinner />}
          title={t("tickets.order.confirming")}
          description={t("tickets.order.confirmingDescription")}
        />
      </Container>
    );
  }

  if (order.status !== "paid") {
    return (
      <Container size="sm">
        <EmptyState
          icon={<Ticket />}
          title={t("tickets.order.failedTitle")}
          description={t("tickets.order.failedDescription")}
          action={
            <Button asChild>
              <NextLink href={eventPagePath(order.event_id)}>{t("tickets.order.backToEvent")}</NextLink>
            </Button>
          }
        />
      </Container>
    );
  }

  return (
    <Container size="sm">
      <Stack gap={6}>
        <PageHeader
          icon={CheckCircle2}
          title={t("tickets.order.paidTitle")}
          description={t("tickets.order.paidDescription", { count: order.tickets.length })}
          actions={
            <Button variant="outline" asChild>
              <NextLink href={ROUTES.TICKETS}>{t("tickets.order.allTickets")}</NextLink>
            </Button>
          }
        />
        {order.tickets.length > 1 ? (
          <p className="text-sm text-muted-foreground">{t("tickets.order.shareNote")}</p>
        ) : null}
        {order.tickets.map((ticket) => (
          <TicketPass key={ticket.code} ticket={ticket} />
        ))}
      </Stack>
    </Container>
  );
}
