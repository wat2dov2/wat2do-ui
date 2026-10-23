import { useTranslation } from "react-i18next";
import type { ApiEventTicketSalesResponse } from "@/shared/generated";
import { FormGrid } from "@/shared/layout";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/shared/ui/card";
import { CheckCircle2, Coins, Ticket, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCents } from "@/shared/utils/currency";

/** Sold, revenue, admitted and seats left for one ticketed event. */
export function TicketSalesStats({ sales }: { sales: ApiEventTicketSalesResponse }) {
  const { t, i18n } = useTranslation();
  const remaining = sales.dates.reduce<number | null>(
    (total, date) => (date.remaining == null || total == null ? null : total + date.remaining),
    0,
  );
  const stats: Array<{ key: string; icon: LucideIcon; label: string; value: string }> = [
    { key: "sold", icon: Ticket, label: t("tickets.desk.stats.sold"), value: String(sales.sold) },
    {
      key: "revenue",
      icon: Coins,
      label: t("tickets.desk.stats.revenue"),
      value: formatCents(sales.revenue_cents, sales.currency, i18n.language),
    },
    {
      key: "checkedIn",
      icon: CheckCircle2,
      label: t("tickets.desk.stats.checkedIn"),
      value: `${sales.checked_in} / ${sales.sold}`,
    },
    {
      key: "remaining",
      icon: Users,
      label: t("tickets.desk.stats.remaining"),
      value: remaining == null ? t("tickets.desk.stats.unlimited") : String(remaining),
    },
  ];
  return (
    <FormGrid columns={4}>
      {stats.map(({ key, icon: Icon, label, value }) => (
        <Card key={key}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardAction>
              <Icon className="size-5 text-primary" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
          </CardContent>
        </Card>
      ))}
    </FormGrid>
  );
}
