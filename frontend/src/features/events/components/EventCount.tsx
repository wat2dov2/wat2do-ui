import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { Button } from "@/shared/ui/button";
import { Stack } from "@/shared/layout";
import { useMouseDownAction } from "@/shared/hooks";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { LatestAddedEvent } from "@/features/events/api/events.api";

interface EventCountProps {
  count: number;
  latestAddedEvent: LatestAddedEvent;
  onLatestAddedEventSearch: () => void;
  /** Page-level action for this heading, e.g. submitting an event. */
  action?: ReactNode;
}

export function EventCount({
  count,
  latestAddedEvent,
  onLatestAddedEventSearch,
  action,
}: EventCountProps) {
  const { t } = useTranslation();
  const handleLatestAddedMouseDown = useMouseDownAction(onLatestAddedEventSearch);

  return (
    <Stack gap={2}>
      <Stack direction="horizontal" align="center" justify="between" gap={3} wrap>
        <PageCountHeading
          count={count}
          label={t("events.upcomingEventCount", { count })}
        />
        {action}
      </Stack>
      {latestAddedEvent ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={handleLatestAddedMouseDown}
          className="min-w-0 self-start text-left"
        >
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
