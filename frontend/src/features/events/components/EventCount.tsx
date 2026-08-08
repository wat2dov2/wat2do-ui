import { useTranslation } from "react-i18next";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Stack } from "@/shared/layout";
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
    <Stack gap={2}>
      <PageCountHeading
        count={count}
        label={t("events.upcomingEventCount", { count })}
      />
      {latestAddedEvent ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={handleLatestAddedMouseDown}
          className="min-w-0 max-w-full self-start gap-2 text-left"
        >
          {/* The pulsing badge carries "recent"; the text only has to say what. */}
          <Badge variant="new" size="sm" className="shrink-0">
            {t("events.new")}
          </Badge>
          <span className="truncate">
            {t("events.latestAddedEvent", {
              title: latestAddedEvent.title,
              time: formatRelativeTime(latestAddedEvent.added_at, t, {
                alwaysAgo: true,
              }),
            })}
          </span>
        </Button>
      ) : null}
    </Stack>
  );
}
