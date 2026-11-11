import { useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout/stack";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

/** A number the card shows as a badge; null while it loads. */
interface AdminCardCount {
  label: string;
  count: number | null;
}

interface AdminCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Work waiting for an admin, such as submissions to review. */
  pendingCounts?: AdminCardCount[];
  /** Things gone wrong that an admin should look at, such as accounts gone quiet. */
  alerts?: AdminCardCount[];
  onClick?: () => void;
  className?: string;
}

export function AdminCard({
  icon: Icon,
  title,
  description,
  pendingCounts = [],
  alerts = [],
  onClick,
  className = "",
}: AdminCardProps) {
  const { t, i18n } = useTranslation();
  const baseClasses = "bg-surface text-foreground hover:bg-surface-hover rounded-xl p-6 flex flex-col items-start gap-3 transition-colors text-left border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const counts = [
    ...pendingCounts.map(({ label, count }) => ({ label, count, text: (value: string) => t("admin.pendingCount", { label, value }) })),
    ...alerts.map(({ label, count }) => ({ label, count, text: (value: string) => t("admin.alertCount", { label, value }) })),
  ];

  const Component = onClick ? "button" : "div";

  return (
    <Component
      onClick={onClick}
      className={`${baseClasses} ${className}`}
    >
      <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center">
        <Icon className="size-5 text-primary" />
      </div>
      <Stack grow gap={2}>
        <h3 className="font-semibold text-foreground">{title}</h3>
        {counts.length > 0 ? (
          <Stack gap={2} align="start" aria-live="polite" data-slot="admin-card-counts">
            {counts.map(({ label, count, text }) => count === null ? (
              <Skeleton key={label} className="h-5 w-32" role="status" aria-label={`${label}: ${t("common.loading")}`} />
            ) : (
              <Badge key={label} variant={count ? "warning" : "muted"}>
                {text(count.toLocaleString(i18n.language))}
              </Badge>
            ))}
          </Stack>
        ) : null}
        <p className="text-xs text-muted-foreground">{description}</p>
      </Stack>
      {onClick && <ArrowRight className="size-4 text-muted-foreground" />}
    </Component>
  );
}
