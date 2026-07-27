import { useTranslation } from "react-i18next";
import type { PosterPayoutStatus } from "@/features/admin/api/admin.api";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

const statusClasses: Record<PosterPayoutStatus, string> = {
  pending: "border-warning/30 bg-warning/15 text-warning",
  held: "border-destructive/30 bg-destructive/15 text-destructive",
  paid: "border-success/30 bg-success/15 text-success",
  voided: "border-border bg-muted text-muted-foreground",
};

interface PosterPayoutStatusBadgeProps {
  status: PosterPayoutStatus;
}

export function PosterPayoutStatusBadge({
  status,
}: PosterPayoutStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      variant="outline"
      size="md"
      className={cn("capitalize", statusClasses[status])}
    >
      {t(`admin.posterPayouts.status.${status}`)}
    </Badge>
  );
}
