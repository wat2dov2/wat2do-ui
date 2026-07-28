import { useTranslation } from "react-i18next";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { Button } from "@/shared/ui/button";
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
        // Event titles are unbounded, so this compact action must wrap on narrow screens.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={handleLatestAddedMouseDown}
          className="h-auto min-h-8 min-w-0 shrink whitespace-normal text-left"
        >
          {t("events.latestAddedEvent", {
            title: latestAddedEvent.title,
            time: formatRelativeTime(latestAddedEvent.added_at, t, {
              alwaysAgo: true,
            }),
          })}
        </Button>
      ) : null}
    </span>
  );
}
