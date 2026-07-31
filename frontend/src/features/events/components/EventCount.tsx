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
    // The count keeps its own line at every width. Sharing a row with the
    // action let the action's width bear on the heading; the newest-event note
    // and the action now sit together on the line underneath instead.
    <Stack gap={2}>
      <PageCountHeading
        count={count}
        label={t("events.upcomingEventCount", { count })}
      />
      {latestAddedEvent || action ? (
        <Stack direction="horizontal" align="center" gap={3} wrap>
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
          {/* Pinned to the end so the action holds its place whether or not
              the newest-event note is present. */}
          {action ? <div className="ms-auto shrink-0">{action}</div> : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
