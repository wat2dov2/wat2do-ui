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
        <Stack direction="horizontal" align="center" justify="between" gap={3}>
          {latestAddedEvent ? (
            // Event titles are unbounded. The note gives up width to the action
            // and truncates rather than wrapping, so the row stays one line.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={handleLatestAddedMouseDown}
              className="min-w-0 shrink text-left"
            >
              {/* Button is a flex container, where text-overflow does not
                  apply; the ellipsis has to live on a block child. */}
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
          {/* ms-auto keeps the action at the end even when the note is absent
              and space-between would otherwise pull it left. */}
          {action ? <div className="ms-auto shrink-0">{action}</div> : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
