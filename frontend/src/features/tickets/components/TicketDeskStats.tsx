import { useTranslation } from "react-i18next";
import type { ApiEventTicketDeskResponse } from "@/shared/generated";
import { FormGrid } from "@/shared/layout";
import { StatCard } from "@/shared/ui/stat-card";
import { CheckCircle2, Coins, Ticket, Users } from "lucide-react";
import { formatCents } from "@/shared/utils/currency";

/** Tickets out, people in, seats left and, for paid tickets, the money. */
export function TicketDeskStats({ desk }: { desk: ApiEventTicketDeskResponse }) {
  const { t, i18n } = useTranslation();
  const remaining = desk.ticketing.remaining;
  const currency = desk.ticketing.currency;
  return (
    <FormGrid columns={currency ? 4 : 3}>
      <StatCard icon={Ticket} label={t("tickets.desk.stats.issued")} value={String(desk.issued)} />
      <StatCard
        icon={CheckCircle2}
        label={t("tickets.desk.stats.checkedIn")}
        value={`${desk.checked_in} / ${desk.issued}`}
      />
      <StatCard
        icon={Users}
        label={t("tickets.desk.stats.remaining")}
        value={remaining == null ? t("tickets.desk.stats.unlimited") : String(remaining)}
      />
      {currency ? (
        <StatCard
          icon={Coins}
          label={t("tickets.desk.stats.revenue")}
          value={formatCents(desk.revenue_cents, currency, i18n.language)}
        />
      ) : null}
    </FormGrid>
  );
}
