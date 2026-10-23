"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { TicketCheckInControl } from "@/features/tickets/components/TicketCheckInControl";
import { TicketPass } from "@/features/tickets/components/TicketPass";
import { TicketRefundRequest } from "@/features/tickets/components/TicketRefundRequest";
import { useTicket } from "@/features/tickets/hooks/useTickets";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { Ticket } from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";

/** One ticket by its code: the holder's pass, with check-in for the club's officers. */
export function TicketPage() {
  const { t } = useTranslation();
  const params = useParams<{ code?: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code ?? "";
  // Change emails link here with ?refund=1 to open the holder's refund request.
  const offered = useSearchParams().get("refund") === "1";
  const { data: ticket, isPending, isError } = useTicket(code);

  return (
    <Container size="sm">
      <Stack gap={6}>
        <PageHeader back={{ href: ROUTES.TICKETS, label: t("tickets.title") }} />
        {isPending ? (
          <Skeleton className="h-[32rem] w-full rounded-2xl" />
        ) : isError || !ticket ? (
          <EmptyState
            icon={<Ticket />}
            title={t("tickets.notFound.title")}
            description={t("tickets.notFound.description")}
          />
        ) : (
          <Stack gap={4}>
            <TicketPass ticket={ticket}>
              {ticket.can_check_in ? <TicketCheckInControl ticket={ticket} /> : null}
            </TicketPass>
            <TicketRefundRequest ticket={ticket} offered={offered} />
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
