import { useTranslation } from "react-i18next";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { useMouseDownAction } from "@/shared/hooks";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { LatestAddedEvent } from "@/features/events/api/events.api";

interface EventCountProps {
  count: number;
  latestAddedEvent: LatestAddedEvent;
  onLatestAddedEventSearch: () => void;
}

export function EventCount({
  count,
  latestAddedEvent,
  onLatestAddedEventSearch,
}: EventCountProps) {
  const { t } = useTranslation();
  const handleLatestAddedMouseDown = useMouseDownAction(onLatestAddedEventSearch);

  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <PageCountHeading
        count={count}
        label={t("events.upcomingEventCount", { count })}
      />
      {latestAddedEvent ? (
        <button
          type="button"
          onMouseDown={handleLatestAddedMouseDown}
          className="cursor-pointer text-left text-xs font-medium text-muted-foreground opacity-80 underline-offset-4 transition-[color,opacity] hover:text-foreground hover:opacity-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t("events.latestAddedEvent", {
            title: latestAddedEvent.title,
            time: formatRelativeTime(latestAddedEvent.added_at, t, { alwaysAgo: true }),
          })}
        </button>
      ) : null}
    </span>
  );
}
