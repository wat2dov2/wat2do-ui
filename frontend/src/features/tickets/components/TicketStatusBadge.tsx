import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";

interface TicketStatusBadgeProps {
  status: "valid" | "refunded";
  checkedInAt?: string | null;
}

export function TicketStatusBadge({ status, checkedInAt }: TicketStatusBadgeProps) {
  const { t } = useTranslation();
  if (status === "refunded") {
    return <Badge variant="destructive">{t("tickets.status.refunded")}</Badge>;
  }
  if (checkedInAt) {
    return <Badge variant="success">{t("tickets.status.checkedIn")}</Badge>;
  }
  return <Badge variant="outline">{t("tickets.status.valid")}</Badge>;
}
