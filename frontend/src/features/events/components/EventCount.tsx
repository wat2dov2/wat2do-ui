import { useTranslation } from "react-i18next";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { LatestAddedEvent } from "@/features/events/api/events.api";

interface EventCountProps {
  count: number;
  latestAddedEvent: LatestAddedEvent;
}

export function EventCount({ count, latestAddedEvent }: EventCountProps) {
  const { t } = useTranslation();

  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <PageCountHeading
        count={count}
        label={t("events.upcomingEventCount", { count })}
      />
      {latestAddedEvent ? (
        <span className="text-xs font-medium text-muted-foreground">
          {t("events.latestAddedEvent", {
            title: latestAddedEvent.title,
            time: formatRelativeTime(latestAddedEvent.added_at, t),
          })}
        </span>
      ) : null}
    </span>
  );
}
