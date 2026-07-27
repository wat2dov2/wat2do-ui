import { useTranslation } from "react-i18next";

import type { PromoterPayout } from "@/features/posters/types";
import { formatCadCents } from "@/shared/utils/currency";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

interface PromoterPayoutHistoryProps {
  payouts: PromoterPayout[];
}

export function PromoterPayoutHistory({
  payouts,
}: PromoterPayoutHistoryProps) {
  const { t, i18n } = useTranslation();

  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      data-testid="payout-history"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("posters.payouts.period")}</TableHead>
            <TableHead>{t("posters.payouts.visitors")}</TableHead>
            <TableHead>{t("posters.payouts.rate")}</TableHead>
            <TableHead>{t("posters.payouts.amount")}</TableHead>
            <TableHead>{t("posters.payouts.status")}</TableHead>
            <TableHead>{t("posters.payouts.paidDate")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payouts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-10 text-center text-muted-foreground"
              >
                {t("posters.payouts.empty")}
              </TableCell>
            </TableRow>
          ) : (
            payouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell>{payout.period}</TableCell>
                <TableCell>{payout.visitorCount}</TableCell>
                <TableCell>
                  {formatCadCents(payout.rateCents, i18n.language)}
                </TableCell>
                <TableCell>
                  {formatCadCents(payout.amountCents, i18n.language)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      payout.status === "paid"
                        ? "success"
                        : payout.status === "held"
                          ? "warning"
                          : payout.status === "voided"
                            ? "muted"
                            : "secondary"
                    }
                  >
                    {t(`posters.payouts.statuses.${payout.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>{payout.paidAt?.slice(0, 10) ?? "-"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
